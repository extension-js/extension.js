import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'
import {createFirefoxContext} from '../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'
import {
  FAKE_BROWSER_PID,
  type FakeChromium,
  type FakeFirefox,
  fakeChromium,
  fakeFirefox
} from './fake-browser'

const PIPE_STDIO = ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] as const

function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({port, host: '127.0.0.1'})
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => resolve(false))
  })
}

describe('the fake browser the launcher specs share', () => {
  let chromium: FakeChromium | undefined
  let firefox: FakeFirefox | undefined

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    await chromium?.close()
    await firefox?.close()
    chromium = undefined
    firefox = undefined
    vi.restoreAllMocks()
  })

  const spawnChromium = (fake: FakeChromium) =>
    fake.deps.spawn({
      binary: fake.project.plantBinary(),
      launchArgs: [`--remote-debugging-port=${fake.port}`],
      stdio: [...PIPE_STDIO],
      browser: 'chrome'
    })

  const spawnFirefox = (fake: FakeFirefox) =>
    fake.deps.spawn({
      binary: fake.project.plantBinary(),
      args: ['-start-debugger-server', String(fake.port)],
      stdio: ['pipe', 'pipe', 'pipe']
    })

  it('seals the variables a launch reads to find a browser', async () => {
    chromium = await fakeChromium()

    expect(process.env.HOME).toBe(chromium.project.root)
    expect(process.env.EXT_BROWSERS_CACHE_DIR).toBe(
      path.join(chromium.project.root, 'cache', 'browsers')
    )

    for (const name of ['CHROME_BINARY', 'EDGE_BINARY', 'FIREFOX_BINARY']) {
      expect(process.env[name]).toBeUndefined()
    }

    expect(process.env.EXTENSION_NO_INSTALL_PROMPT).toBe('1')
  })

  it('a ready Chromium binds its port and answers on the pipe', async () => {
    chromium = await fakeChromium()
    const child = await spawnChromium(chromium)

    expect(child.pid).toBe(FAKE_BROWSER_PID)
    expect(await portAnswers(chromium.port)).toBe(true)

    const answer = new Promise<string>((resolve) =>
      child.stdio[4]?.once('data', (chunk) => resolve(String(chunk)))
    )
    ;(child.stdio[3] as NodeJS.WritableStream).write(
      `${JSON.stringify({id: 7, method: 'Extensions.loadUnpacked'})}\0`
    )

    expect(await answer).toBe(
      `${JSON.stringify({id: 7, result: {id: 'a'.repeat(32)}})}\0`
    )

    expect(chromium.commands).toEqual([
      {method: 'Extensions.loadUnpacked', params: undefined}
    ])
  })

  it('a Chromium that never binds its port leaves it closed', async () => {
    chromium = await fakeChromium({script: {bindsPort: false}})
    await spawnChromium(chromium)

    expect(await portAnswers(chromium.port)).toBe(false)
  })

  it('a browser that exits before it is ready closes with its code and frees the port', async () => {
    chromium = await fakeChromium({
      script: {exitsAfterMs: 0, exit: {code: 7, signal: null}}
    })

    const child = await spawnChromium(chromium)
    const closed = await new Promise<[number | null, string | null]>(
      (resolve) =>
        child.once('close', (code, signal) => resolve([code, signal]))
    )

    expect(closed).toEqual([7, null])
    expect(await portAnswers(chromium.port)).toBe(false)
  })

  it('a handshake that dies closes the pipe on the first command', async () => {
    chromium = await fakeChromium({script: {handshake: 'dies'}})
    const child = await spawnChromium(chromium)
    const closed = new Promise<void>((resolve) =>
      child.stdio[4]?.once('close', () => resolve())
    )
    ;(child.stdio[3] as NodeJS.WritableStream).write(
      `${JSON.stringify({id: 1, method: 'Target.getTargets'})}\0`
    )

    await closed
    expect(chromium.child()?.exited).toBe(false)
  })

  it('a slow browser answers only after its delay', async () => {
    vi.useFakeTimers()

    try {
      chromium = await fakeChromium({script: {answerDelayMs: 5000}})
      const child = await spawnChromium(chromium)
      const chunks: string[] = []
      child.stdio[4]?.on('data', (chunk) => chunks.push(String(chunk)))
      ;(child.stdio[3] as NodeJS.WritableStream).write(
        `${JSON.stringify({id: 1, method: 'Target.getTargets'})}\0`
      )

      await vi.advanceTimersByTimeAsync(4999)
      expect(chunks).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      expect(chunks).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records the signals a child was sent and ends on them, or ignores them when told to', async () => {
    chromium = await fakeChromium()
    const child = await spawnChromium(chromium)
    const closed = new Promise<[number | null, string | null]>((resolve) =>
      child.once('close', (code, signal) => resolve([code, signal]))
    )
    chromium.deps.terminate(child, 'chrome')

    expect(await closed).toEqual([null, 'SIGTERM'])
    expect(chromium.child()?.signals).toEqual(['SIGTERM'])
    expect(chromium.deps.terminatedByUs(child)).toBe(true)
    await chromium.close()

    chromium = await fakeChromium({script: {diesOnSignal: false}})
    const stubborn = await spawnChromium(chromium)
    stubborn.kill('SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))

    expect(chromium.child()?.exited).toBe(false)
    expect(chromium.deps.terminatedByUs(stubborn)).toBe(false)
  })

  it('a spawn failure rejects and leaves no child', async () => {
    const failure = Object.assign(new Error('spawn ENOENT'), {code: 'ENOENT'})
    firefox = await fakeFirefox({script: {spawnError: failure}})

    await expect(spawnFirefox(firefox)).rejects.toBe(failure)
    expect(firefox.child()).toBeUndefined()
  })

  it('carries a run-only Chromium launch to a loaded guest', async () => {
    chromium = await fakeChromium()
    const pin = chromium.project.plantBinary()
    chromium.project.writeReady({
      command: 'preview',
      status: 'starting',
      runId: 'run-1'
    })

    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: [chromium.project.out],
        chromiumBinary: pin
      } as never,
      createChromiumContext() as never,
      chromium.deps
    )

    await plugin.runOnce(chromium.project.compilation() as never, {
      enableCdpPostLaunch: false,
      sessionCommand: 'preview'
    })

    expect(plugin.spawnedBrowser).toBe(true)
    expect(chromium.spawns).toHaveLength(1)
    expect(chromium.spawns[0].binary).toBe(pin)
    expect(chromium.probed).toEqual([pin])
    expect(chromium.located).toEqual([])
    expect(chromium.commands.map((command) => command.method)).toEqual([
      'Target.setDiscoverTargets',
      'Target.setDiscoverTargets',
      'Target.getTargets',
      'Extensions.loadUnpacked',
      'Target.getTargets'
    ])

    expect(chromium.claims).toEqual([
      {requested: 9222, port: chromium.port, released: 1}
    ])

    expect(chromium.signalWatchers).toEqual({registered: 1, disposed: 0})
    expect(chromium.project.readReady()).toMatchObject({
      browserPid: FAKE_BROWSER_PID,
      binary: pin,
      cdpPort: chromium.port,
      extensionId: 'a'.repeat(32)
    })
  })

  it('carries a Firefox launch to an installed add-on', async () => {
    firefox = await fakeFirefox()
    const pin = firefox.project.plantBinary()
    firefox.project.writeReady({
      command: 'preview',
      status: 'starting',
      runId: 'run-1'
    })

    const plugin = new FirefoxLaunchPlugin(
      {
        browser: 'firefox',
        extension: [firefox.project.out],
        geckoBinary: pin
      } as never,
      createFirefoxContext() as never,
      firefox.deps
    )

    await plugin.runOnce(
      firefox.project.compilation() as never,
      {browser: 'firefox', mode: 'production'} as never
    )

    expect(plugin.spawnedBrowser).toBe(true)
    expect(firefox.spawns).toHaveLength(1)
    expect(firefox.spawns[0].binary).toBe(pin)
    expect(firefox.packets.map((packet) => packet.type)).toEqual([
      'getRoot',
      'installTemporaryAddon',
      'listAddons'
    ])

    expect(firefox.claims).toEqual([
      {requested: 9222, port: firefox.port, released: 1}
    ])

    expect(firefox.project.readReady()).toMatchObject({
      browserPid: FAKE_BROWSER_PID,
      binary: pin,
      rdpPort: firefox.port,
      extensionId: 'fake-guest@extension.js'
    })
  })

  it('removes its folder and restores the variables when closed', async () => {
    const before = process.env.HOME
    chromium = await fakeChromium()
    const root = chromium.project.root
    await chromium.close()
    chromium = undefined

    expect(process.env.HOME).toBe(before)
    expect(fs.existsSync(root)).toBe(false)
  })
})
