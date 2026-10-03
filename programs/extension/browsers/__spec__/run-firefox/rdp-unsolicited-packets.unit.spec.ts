import net from 'node:net'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {getAddonsActorWithRetry} from '../../run-firefox/rdp/remote-firefox/addons-install'
import {openManagerNewTab} from '../../run-firefox/rdp/remote-firefox/manager-tab'
import {MessagingClient} from '../../run-firefox/rdp/remote-firefox/messaging-client'
import {
  buildRdpFrame,
  parseRdpFrame
} from '../../run-firefox/rdp/remote-firefox/rdp-wire'
import {RdpTransport} from '../../run-firefox/rdp/remote-firefox/transport'

type Packet = Record<string, unknown> & {type?: string; to?: string}

type Mock = {
  port: number
  sockets: net.Socket[]
  received: Packet[]
  close: () => Promise<void>
}

const CONSOLE = 'server1.conn0.child1/consoleActor2'
const ADDONS = 'server1.conn0.addonsActor1'

const GREETING = {
  from: 'root',
  applicationType: 'browser',
  testConnectionPrefix: 'server1.conn0.',
  traits: {networkMonitor: true}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function createFirefoxMock(
  answer: (packet: Packet, send: (p: Record<string, unknown>) => void) => void,
  greetAfterMs = 0
): Promise<Mock> {
  return new Promise((resolve) => {
    const sockets: net.Socket[] = []
    const received: Packet[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => {
        // Ignore
      })

      const send = (p: Record<string, unknown>) =>
        socket.write(buildRdpFrame(p))
      setTimeout(() => send(GREETING), greetAfterMs)
      let incoming: Buffer = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        incoming = Buffer.concat([incoming, chunk])

        for (;;) {
          const {remainingData, parsedMessage} = parseRdpFrame<Packet>(incoming)
          incoming = remainingData
          if (!parsedMessage) return

          received.push(parsedMessage)
          answer(parsedMessage, send)
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo
      resolve({
        port,
        sockets,
        received,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            for (const s of sockets) s.destroy()
          })
      })
    })
  })
}

function rootAnswers(
  packet: Packet,
  send: (p: Record<string, unknown>) => void
) {
  if (packet.type === 'getRoot') {
    send({
      from: 'root',
      addonsActor: ADDONS,
      deviceActor: 'server1.conn0.deviceActor1'
    })
  } else if (packet.type === 'listTabs') {
    send({from: 'root', tabs: [{actor: 'server1.conn0.tabDescriptor1'}]})
  }
}

const settled = (p: Promise<unknown>) => {
  let state = 'pending'
  p.then(
    () => {
      state = 'resolved'
    },
    () => {
      state = 'rejected'
    }
  )

  return () => state
}

describe('unsolicited RDP packets', () => {
  let mock: Mock
  let transport: RdpTransport | undefined
  let client: MessagingClient | undefined

  beforeEach(() => {
    transport = undefined
    client = undefined
  })

  afterEach(async () => {
    transport?.disconnect()
    client?.disconnect()
    await mock.close()
  })

  it('connects only once the root greeting is consumed', async () => {
    mock = await createFirefoxMock(rootAnswers, 120)
    transport = new RdpTransport()
    const seen: Packet[] = []
    transport.on('message', (m) => seen.push(m))

    const started = Date.now()
    await transport.connect(mock.port)

    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    expect(mock.sockets).toHaveLength(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({from: 'root', applicationType: 'browser'})
    const root = (await transport.request({
      to: 'root',
      type: 'getRoot'
    })) as Packet
    expect(root.addonsActor).toBe(ADDONS)
    expect(root.applicationType).toBeUndefined()
  })

  it('fails connect when the socket closes before any greeting', async () => {
    mock = await createFirefoxMock(() => {}, 5000)
    transport = new RdpTransport()
    const connecting = transport.connect(mock.port)
    await sleep(30)

    mock.sockets[0].destroy()

    await expect(connecting).rejects.toThrow()
  })

  it('finds the addons actor with a single getRoot and no retry sleep', async () => {
    mock = await createFirefoxMock(rootAnswers)
    client = new MessagingClient()
    await client.connect(mock.port)

    const started = Date.now()
    const actor = await getAddonsActorWithRetry(client, undefined)

    expect(actor).toBe(ADDONS)
    expect(Date.now() - started).toBeLessThan(200)
    expect(mock.received.map((p) => p.type)).toEqual(['getRoot'])
  })

  const unsolicited: Array<[string, Record<string, unknown>]> = [
    ['tabListChanged', {from: 'root', type: 'tabListChanged'}],
    ['addonListChanged', {from: 'root', type: 'addonListChanged'}],
    [
      'consoleAPICall',
      {
        from: CONSOLE,
        type: 'consoleAPICall',
        message: {level: 'log', arguments: [{value: 'hi'}]}
      }
    ],
    [
      'pageError',
      {from: CONSOLE, type: 'pageError', pageError: {errorMessage: 'boom'}}
    ],
    [
      'networkEvent',
      {from: CONSOLE, type: 'networkEvent', eventActor: {actor: 'net1'}}
    ],
    [
      'networkEventUpdate',
      {from: 'net1', type: 'networkEventUpdate', updateType: 'responseStart'}
    ],
    [
      'evaluationResult',
      {from: CONSOLE, type: 'evaluationResult', resultID: 'rid-9', result: 1}
    ],
    [
      'tabNavigated',
      {from: 'server1.conn0.tab1', type: 'tabNavigated', url: 'about:blank'}
    ],
    [
      'target-available-form',
      {
        from: 'server1.conn0.watcher1',
        type: 'target-available-form',
        target: {actor: 't1'}
      }
    ],
    [
      'frameUpdate',
      {from: 'server1.conn0.tab1', type: 'frameUpdate', frames: []}
    ],
    ['the root greeting', GREETING]
  ]

  it.each(
    unsolicited
  )('leaves the in-flight request pending when %s arrives from its actor', async (_name, packet) => {
    mock = await createFirefoxMock(() => {})
    transport = new RdpTransport()
    await transport.connect(mock.port)
    const seen: Packet[] = []
    transport.on('message', (m) => seen.push(m))
    const actor = String(packet.from)

    const request = transport.request({to: actor, type: 'ping'})
    const state = settled(request)
    await sleep(30)

    mock.sockets[0].write(buildRdpFrame(packet))
    await sleep(50)

    expect(state()).toBe('pending')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject(packet)

    mock.sockets[0].write(buildRdpFrame({from: actor, pong: true}))
    await expect(request).resolves.toMatchObject({from: actor, pong: true})
  })

  it('never hands a console event back as the evaluation result', async () => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'listAddons') {
        send({
          from: 'root',
          addons: [
            {id: 'devtools@extension.js', actor: 'a1', consoleActor: CONSOLE}
          ]
        })
      } else if (packet.type === 'evaluateJSAsync') {
        send({
          from: CONSOLE,
          type: 'consoleAPICall',
          message: {level: 'log', arguments: [{value: 'hello from background'}]}
        })

        send({from: CONSOLE, resultID: 'rid-1'})
        send({
          from: CONSOLE,
          type: 'evaluationResult',
          resultID: 'rid-1',
          result: true
        })
      }
    })

    client = new MessagingClient()
    await client.connect(mock.port)

    expect(await client.evaluate(CONSOLE, 'x')).toBe(true)
    expect(await openManagerNewTab(client)).toBe(true)
    expect(mock.received.map((p) => p.type)).toEqual([
      'evaluateJSAsync',
      'listAddons',
      'evaluateJSAsync'
    ])
  })

  it('keeps an evaluation result that lands before the request id is known', async () => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'evaluateJSAsync') {
        send({
          from: CONSOLE,
          type: 'evaluationResult',
          resultID: 'rid-2',
          result: 42
        })

        send({from: CONSOLE, resultID: 'rid-2'})
      }
    })

    client = new MessagingClient()
    await client.connect(mock.port)

    expect(await client.evaluate(CONSOLE, '42')).toBe(42)
  })
})
