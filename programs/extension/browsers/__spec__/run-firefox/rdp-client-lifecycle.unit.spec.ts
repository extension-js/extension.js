import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import net from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createFirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {FirefoxRDPController} from '../../run-firefox/rdp/rdp-extension-controller'
import {RemoteFirefox} from '../../run-firefox/rdp/remote-firefox'
import {MessagingClient} from '../../run-firefox/rdp/remote-firefox/messaging-client'
import {
  buildRdpFrame,
  parseRdpFrame
} from '../../run-firefox/rdp/remote-firefox/rdp-wire'

type Packet = Record<string, unknown> & {type?: string}

type Mock = {
  port: number
  sockets: net.Socket[]
  accepted: () => number
  open: () => number
  close: () => Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function createRefusingFirefox(): Promise<Mock> {
  return new Promise((resolve) => {
    const sockets: net.Socket[] = []
    let accepted = 0
    let open = 0
    const server = net.createServer((socket) => {
      sockets.push(socket)
      accepted++
      open++
      socket.on('close', () => open--)
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

          if (parsedMessage.type === 'getRoot') {
            send({from: 'root', addonsActor: 'addons1'})
          } else if (parsedMessage.type === 'listTabs') {
            send({from: 'root', tabs: []})
          } else if (parsedMessage.type === 'installTemporaryAddon') {
            send({
              from: 'addons1',
              error: 'addonInstallFailed',
              message: 'Could not install add-on: manifest is invalid'
            })
          }
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo
      resolve({
        port,
        sockets,
        accepted: () => accepted,
        open: () => open,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            for (const s of sockets) s.destroy()
          })
      })
    })
  })
}

let mock: Mock
let project: string
let dist: string

beforeEach(async () => {
  mock = await createRefusingFirefox()
  project = mkdtempSync(join(tmpdir(), 'extjs-rdp-lifecycle-'))
  dist = join(project, 'dist', 'firefox')
  mkdirSync(dist, {recursive: true})
  writeFileSync(
    join(dist, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
  )

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mock.close()
  rmSync(project, {recursive: true, force: true})
})

const compilation = () =>
  ({options: {context: project, output: {path: dist}}}) as never

describe('RDP client lifecycle', () => {
  it('holds one socket at a time across repeated install attempts', async () => {
    const remote = new RemoteFirefox({
      extension: dist,
      browser: 'firefox',
      resolvedRdpPort: mock.port
    } as never)

    for (let i = 0; i < 5; i++) {
      await remote.installAddons(compilation()).catch(() => {})
    }

    await sleep(50)
    expect(mock.accepted()).toBe(5)
    expect(mock.open()).toBe(1)

    remote.disconnect()
    await sleep(50)
    expect(mock.open()).toBe(0)
  }, 20000)

  it('closes the controller connection when the browser is gone', async () => {
    const controller = new FirefoxRDPController(
      {extension: dist, browser: 'firefox'},
      mock.port
    )
    await controller.ensureLoaded(compilation()).catch(() => {})
    await sleep(50)
    expect(mock.open()).toBe(1)

    const host = {
      browser: 'firefox',
      extension: dist,
      rdpController: controller
    }
    const plugin = new FirefoxLaunchPlugin(
      host as never,
      createFirefoxContext()
    )
    ;(
      plugin as unknown as {onBrowserGone: (c: number, e: boolean) => void}
    ).onBrowserGone(0, true)

    await sleep(50)
    expect(mock.open()).toBe(0)
    await sleep(1300)
    expect(mock.accepted()).toBe(1)
  }, 20000)

  it('does not reconnect once disconnected and never holds the loop with its backoff', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const client = new MessagingClient()
    await client.connect(mock.port)
    const ended = new Promise<void>((resolve) => client.on('end', resolve))

    mock.sockets[0].resetAndDestroy()
    await ended
    await sleep(20)

    const backoff = timers.mock.calls.findIndex((call) => call[1] === 1000)
    expect(backoff).toBeGreaterThanOrEqual(0)
    const timer = timers.mock.results[backoff].value as NodeJS.Timeout
    expect(timer.hasRef()).toBe(false)

    client.disconnect()
    await sleep(1300)
    expect(mock.accepted()).toBe(1)
  }, 20000)
})
