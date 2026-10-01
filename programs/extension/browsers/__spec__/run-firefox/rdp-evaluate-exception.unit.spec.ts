import net from 'node:net'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {evaluate} from '../../run-firefox/rdp/remote-firefox/evaluate'
import {openManagerNewTab} from '../../run-firefox/rdp/remote-firefox/manager-tab'
import {MessagingClient} from '../../run-firefox/rdp/remote-firefox/messaging-client'
import {
  buildRdpFrame,
  parseRdpFrame
} from '../../run-firefox/rdp/remote-firefox/rdp-wire'

type Packet = Record<string, unknown> & {type?: string; text?: string}

type Mock = {
  port: number
  received: Packet[]
  close: () => Promise<void>
}

const CONSOLE = 'server1.conn0.child1/consoleActor2'
const THROWN = 'TypeError: api.tabs is undefined'

function createFirefoxMock(
  answer: (packet: Packet, send: (p: Record<string, unknown>) => void) => void
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
      send({from: 'root', applicationType: 'browser'})
      let incoming = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        incoming = Buffer.concat([incoming, chunk])

        for (;;) {
          const {remainingData, parsedMessage} = parseRdpFrame<Packet>(incoming)
          incoming = remainingData
          if (!parsedMessage) return

          received.push(parsedMessage)

          if (parsedMessage.type === 'listAddons') {
            send({
              from: 'root',
              addons: [
                {
                  id: 'devtools@extension.js',
                  actor: 'a1',
                  consoleActor: CONSOLE
                }
              ]
            })
          } else {
            answer(parsedMessage, send)
          }
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo
      resolve({
        port,
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

const thrownResult = (packet: Packet) => ({
  input: packet.text,
  exception: {type: 'object', class: 'TypeError'},
  exceptionMessage: THROWN,
  hasException: true
})

function geckoThrows(
  packet: Packet,
  send: (p: Record<string, unknown>) => void
) {
  if (packet.type === 'evaluateJSAsync') {
    send({from: CONSOLE, resultID: 'rid-1'})
    send({
      from: CONSOLE,
      type: 'evaluationResult',
      resultID: 'rid-1',
      ...thrownResult(packet)
    })

    return
  }

  send({from: CONSOLE, ...thrownResult(packet)})
}

let mock: Mock
let client: MessagingClient

beforeEach(() => {
  client = new MessagingClient()
})

afterEach(async () => {
  client.disconnect()
  await mock.close()
})

describe('RDP evaluation of a throwing expression', () => {
  it('reports the failure with the exception message', async () => {
    mock = await createFirefoxMock(geckoThrows)
    await client.connect(mock.port)

    await expect(client.evaluate(CONSOLE, 'boom()')).rejects.toThrow(THROWN)
    expect(mock.received.map((p) => p.type)).toEqual(['evaluateJSAsync'])
  })

  it('keeps the message when the fallback types are not understood', async () => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'evaluateJSAsync') {
        geckoThrows(packet, send)

        return
      }

      send({
        from: CONSOLE,
        error: 'unrecognizedPacketType',
        message: packet.type
      })
    })

    await client.connect(mock.port)

    await expect(client.evaluate(CONSOLE, 'boom()')).rejects.toThrow(THROWN)
  })

  it('moves on to the next request type when one is not understood', async () => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'evaluateJSAsync') {
        send({
          from: CONSOLE,
          error: 'unrecognizedPacketType',
          message: packet.type
        })

        return
      }

      send({from: CONSOLE, result: 'ok'})
    })

    await client.connect(mock.port)

    expect(await client.evaluate(CONSOLE, '1')).toBe('ok')
    expect(mock.received.map((p) => p.type)).toEqual([
      'evaluateJSAsync',
      'evalWithOptions'
    ])
  })

  it.each([
    [
      'a rejected top-level await',
      {topLevelAwaitRejected: true, exceptionMessage: 'Error: nope'}
    ],
    ['an exception grip alone', {exception: {type: 'object', class: 'Error'}}],
    ['only an exception message', {exceptionMessage: 'Error: nope'}]
  ])('treats %s as a failure', async (_name, shape) => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'evaluateJSAsync') {
        send({from: CONSOLE, resultID: 'rid-1'})
        send({
          from: CONSOLE,
          type: 'evaluationResult',
          resultID: 'rid-1',
          ...shape
        })

        return
      }

      send({from: CONSOLE, ...shape})
    })

    await client.connect(mock.port)

    await expect(evaluate(client, CONSOLE, 'x')).rejects.toThrow()
  })

  it('still resolves a clean result whose exception field is null', async () => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'evaluateJSAsync') {
        send({from: CONSOLE, resultID: 'rid-1'})
        send({
          from: CONSOLE,
          type: 'evaluationResult',
          resultID: 'rid-1',
          result: 7,
          exception: null,
          exceptionMessage: null,
          hasException: false
        })
      }
    })

    await client.connect(mock.port)

    expect(await client.evaluate(CONSOLE, '7')).toBe(7)
  })

  it('makes openManagerNewTab report the tab it could not open', async () => {
    mock = await createFirefoxMock(geckoThrows)
    await client.connect(mock.port)

    expect(await openManagerNewTab(client)).toBe(false)
  })

  it('makes openManagerNewTab report an evaluation that did not confirm', async () => {
    mock = await createFirefoxMock((packet, send) => {
      if (packet.type === 'evaluateJSAsync') {
        send({from: CONSOLE, resultID: 'rid-1'})
        send({
          from: CONSOLE,
          type: 'evaluationResult',
          resultID: 'rid-1',
          result: {type: 'undefined'},
          exception: null
        })
      }
    })

    await client.connect(mock.port)

    expect(await openManagerNewTab(client)).toBe(false)
  })
})
