import * as fs from 'node:fs'
import net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {RemoteFirefox} from '../../run-firefox/rdp/remote-firefox'
import {
  buildRdpFrame,
  parseRdpFrame
} from '../../run-firefox/rdp/remote-firefox/rdp-wire'

type Packet = Record<string, unknown> & {type?: string}

// A Firefox that refuses every install, so a run ends on the first add-on it
// was handed and the order shows in what it received.
function createRefusingFirefox(): Promise<{
  port: number
  installs: string[]
  close: () => Promise<void>
}> {
  return new Promise((resolve) => {
    const sockets: net.Socket[] = []
    const installs: string[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => {
        // Ignore
      })

      const send = (p: Record<string, unknown>) =>
        socket.write(buildRdpFrame(p))
      send({from: 'root', applicationType: 'browser'})
      let incoming: Buffer = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        incoming = Buffer.concat([incoming, chunk])

        for (;;) {
          const {remainingData, parsedMessage} = parseRdpFrame<Packet>(incoming)
          incoming = remainingData
          if (!parsedMessage) return

          if (parsedMessage.type === 'getRoot') {
            send({from: 'root', addonsActor: 'addons1'})
          } else if (parsedMessage.type === 'installTemporaryAddon') {
            installs.push(String(parsedMessage.addonPath))
            send({
              from: 'addons1',
              error: 'addonInstallFailed',
              message: 'Could not install add-on: refused by the test'
            })
          }
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo
      resolve({
        port,
        installs,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            for (const s of sockets) s.destroy()
          })
      })
    })
  })
}

describe('the order Firefox is handed the add-ons in', () => {
  let firefox: Awaited<ReturnType<typeof createRefusingFirefox>>
  let project: string
  let dist: string

  function addonAt(dir: string): string {
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
    )

    return dir
  }

  async function firstInstall(manager: string): Promise<string[]> {
    const remote = new RemoteFirefox({
      extension: [manager, dist],
      browser: 'firefox',
      resolvedRdpPort: firefox.port
    } as never)

    try {
      await expect(
        remote.installAddons({
          options: {context: project, output: {path: dist}}
        } as never)
      ).rejects.toMatchObject({code: 'E_ADDON_INSTALL'})
    } finally {
      remote.disconnect()
    }

    return firefox.installs
  }

  beforeEach(async () => {
    firefox = await createRefusingFirefox()
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-addon-order-'))
    dist = addonAt(path.join(project, 'dist', 'firefox'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await firefox.close()
    fs.rmSync(project, {recursive: true, force: true})
  })

  it.skipIf(process.platform === 'win32')(
    'installs the user add-on before a manager named with forward slashes',
    async () => {
      const manager = addonAt(
        path.join(project, 'extensions', 'firefox-manager')
      )

      expect(await firstInstall(manager)).toEqual([dist])
    }
  )

  // Pins today's behavior. Ledger 1374 D14.
  it('installs a manager named with backslashes first, as if it were the user add-on', async () => {
    // One folder with a backslash in its name here, a nested one on Windows.
    const manager = addonAt(path.join(project, 'extensions\\firefox-manager'))

    expect(await firstInstall(manager)).toEqual([manager])
  })
})
