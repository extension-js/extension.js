import {type ChildProcess, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {
  chromiumOptions,
  chromiumRunOnce,
  firefoxRunOnce,
  printProdBannerOnce,
  launched
} = vi.hoisted(() => ({
  chromiumOptions: vi.fn((_options: Record<string, unknown>) => {}),
  chromiumRunOnce: vi.fn(async () => {}),
  firefoxRunOnce: vi.fn(async () => {}),
  printProdBannerOnce: vi.fn(async () => true),
  // What the stand-in launchers say about the browser they started.
  launched: {spawned: false, closed: false}
}))

vi.mock('../../run-chromium/chromium-context', () => ({
  createChromiumContext: vi.fn(() => ({}))
}))

const {createFirefoxContext} = vi.hoisted(() => ({
  createFirefoxContext: vi.fn((): Record<string, unknown> => ({}))
}))

vi.mock('../../run-firefox/firefox-context', () => ({createFirefoxContext}))

vi.mock('../../run-chromium/chromium-launch', () => ({
  ChromiumLaunchPlugin: class {
    runOnce = chromiumRunOnce

    get spawnedBrowser() {
      return launched.spawned
    }

    get browserClosed() {
      return launched.closed
    }

    constructor(options: Record<string, unknown>) {
      chromiumOptions(options)
    }
  }
}))

vi.mock('../../run-firefox/firefox-launch', () => ({
  FirefoxLaunchPlugin: class {
    runOnce = firefoxRunOnce

    get spawnedBrowser() {
      return launched.spawned
    }

    get browserClosed() {
      return launched.closed
    }
  }
}))

vi.mock('../../browsers-lib/banner', () => ({
  printProdBannerOnce
}))

// The real claim, with options a case may narrow.
const {claimOptions} = vi.hoisted(() => ({
  claimOptions: {current: {} as {maxAttempts?: number; dir?: string}}
}))

vi.mock('../../browsers-lib/debug-port-claim', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../browsers-lib/debug-port-claim')>()

  return {
    ...actual,
    claimDebugPortNear: (
      startPort: number,
      options?: Parameters<typeof actual.claimDebugPortNear>[1]
    ) =>
      actual.claimDebugPortNear(startPort, {
        ...options,
        ...claimOptions.current
      })
  }
})

import {createPlaywrightMetadataWriter} from '../../../../develop/plugin-playwright'
import {
  runOnlyPreviewBrowser,
  warnIgnoredHostPermissionPatterns
} from '../../run-only'

// The spec's own folder: a fixed /tmp/ext can exist on a shared machine.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-only-'))
const EXT = path.join(scratch, 'ext')
const EXT_FIREFOX = path.join(scratch, 'ext-firefox')

// A session that launched keeps its signal listeners for the life of the
// process, so each row takes back what the rows before it left.
const SESSION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
const listenersAtLoad = new Map(
  SESSION_SIGNALS.map((name) => [name, process.listeners(name)])
)

afterEach(() => {
  for (const name of SESSION_SIGNALS) {
    for (const listener of process.listeners(name)) {
      if (!listenersAtLoad.get(name)?.includes(listener)) {
        process.removeListener(name, listener)
      }
    }
  }
})

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

describe('runOnlyPreviewBrowser', () => {
  beforeEach(() => {
    chromiumRunOnce.mockClear()
    firefoxRunOnce.mockClear()
    printProdBannerOnce.mockClear()
  })

  it('prints production banner for chromium preview', async () => {
    await runOnlyPreviewBrowser({
      browser: 'chromium',
      outPath: EXT,
      contextDir: scratch,
      extensionsToLoad: [EXT]
    })

    expect(chromiumRunOnce).toHaveBeenCalledTimes(1)
    expect(chromiumRunOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mode: 'production',
          context: scratch,
          output: {path: EXT}
        }),
        errors: []
      }),
      expect.objectContaining({enableCdpPostLaunch: false})
    )

    expect(printProdBannerOnce).toHaveBeenCalledWith({
      browser: 'chromium',
      outPath: EXT,
      includeExtensionId: true,
      includeRunId: false,
      readyPath: undefined,
      browserVersionLine: undefined
    })
  })

  // browser.<name>.persistProfile is one switch, so a preview on Chromium
  // keeps the profile the way a preview on Firefox does.
  it('hands the kept-profile switch to the chromium launcher', async () => {
    chromiumOptions.mockClear()

    await runOnlyPreviewBrowser({
      browser: 'chrome',
      outPath: EXT,
      contextDir: scratch,
      extensionsToLoad: [EXT],
      persistProfile: true
    })

    expect(chromiumOptions).toHaveBeenCalledWith(
      expect.objectContaining({persistProfile: true})
    )
  })

  // preview and start honor the kept profile and its seed as dev does.
  it('hands the kept-profile changes and the seed profile to the chromium launcher', async () => {
    chromiumOptions.mockClear()

    await runOnlyPreviewBrowser({
      browser: 'chrome',
      outPath: EXT,
      contextDir: scratch,
      extensionsToLoad: [EXT],
      keepProfileChanges: true,
      copyFromProfile: '/seed/profile'
    })

    expect(chromiumOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        keepProfileChanges: true,
        copyFromProfile: '/seed/profile'
      })
    )
  })

  it('hands the kept-profile changes and the seed profile to the firefox launch', async () => {
    await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: EXT_FIREFOX,
      contextDir: scratch,
      extensionsToLoad: [EXT_FIREFOX],
      keepProfileChanges: true,
      copyFromProfile: '/seed/profile'
    })

    expect(firefoxRunOnce).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        keepProfileChanges: true,
        copyFromProfile: '/seed/profile'
      })
    )
  })

  it('names the debugging port on the run record before the card prints, and hands the same port to the launch', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-only-port-'))
    const outPath = path.join(dir, 'dist', 'chrome')
    const readyPath = path.join(
      dir,
      'dist',
      'extension-js',
      'chrome',
      'ready.json'
    )
    fs.mkdirSync(outPath, {recursive: true})
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({runId: 'run-1', command: 'preview', status: 'starting'})
    )

    let portAtCard: unknown
    printProdBannerOnce.mockImplementationOnce(async () => {
      portAtCard = JSON.parse(fs.readFileSync(readyPath, 'utf8')).cdpPort

      return true
    })

    try {
      await runOnlyPreviewBrowser({
        browser: 'chrome',
        outPath,
        readyPath,
        contextDir: dir,
        extensionsToLoad: [outPath]
      })

      const launch = chromiumRunOnce.mock.calls[0] as unknown as [
        unknown,
        {debugPortClaim: {port: number; release(): void}}
      ]

      expect(typeof portAtCard).toBe('number')
      expect(launch[1].debugPortClaim.port).toBe(portAtCard)

      launch[1].debugPortClaim.release()
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('leaves the port of a run that replaced this one when the launch fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-only-next-'))
    const outPath = path.join(dir, 'dist', 'chrome')
    const readyPath = path.join(
      dir,
      'dist',
      'extension-js',
      'chrome',
      'ready.json'
    )
    fs.mkdirSync(outPath, {recursive: true})
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({runId: 'run-1', command: 'preview', status: 'starting'})
    )

    const next = {
      runId: 'run-2',
      command: 'preview',
      status: 'starting',
      cdpPort: 9333
    }
    const refused = new Error('spawn EACCES')
    chromiumRunOnce.mockImplementationOnce(async () => {
      fs.writeFileSync(readyPath, JSON.stringify(next))

      throw refused
    })

    try {
      await expect(
        runOnlyPreviewBrowser({
          browser: 'chrome',
          outPath,
          readyPath,
          contextDir: dir,
          extensionsToLoad: [outPath]
        })
      ).rejects.toMatchObject({code: 'E_BROWSER_LAUNCH', cause: refused})

      expect(JSON.parse(fs.readFileSync(readyPath, 'utf8'))).toEqual(next)
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('refuses with E_PORT_UNAVAILABLE before the card when no debugging port is free, and records the code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-only-busy-'))
    const outPath = path.join(dir, 'dist', 'chrome')
    const readyPath = path.join(
      dir,
      'dist',
      'extension-js',
      'chrome',
      'ready.json'
    )
    fs.mkdirSync(outPath, {recursive: true})
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({runId: 'run-1', command: 'preview', status: 'starting'})
    )

    const holder = net.createServer()
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve))
    const held = (holder.address() as net.AddressInfo).port
    // One attempt, in a claim folder of this spec's own.
    claimOptions.current = {maxAttempts: 1, dir: path.join(dir, 'claims')}

    try {
      await expect(
        runOnlyPreviewBrowser({
          browser: 'chrome',
          outPath,
          readyPath,
          contextDir: dir,
          extensionsToLoad: [outPath],
          // The debugging port is --port plus 100.
          port: held - 100
        })
      ).rejects.toMatchObject({code: 'E_PORT_UNAVAILABLE'})

      expect(printProdBannerOnce).not.toHaveBeenCalled()
      expect(chromiumRunOnce).not.toHaveBeenCalled()
      expect(JSON.parse(fs.readFileSync(readyPath, 'utf8'))).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_PORT_UNAVAILABLE'
      })
    } finally {
      claimOptions.current = {}
      await new Promise((resolve) => holder.close(resolve))
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  // Shell-script fixture: not executable on Windows, posix-only case.
  it.skipIf(process.platform === 'win32')(
    'describes a chrome-target pin on the card, not the system chrome',
    async () => {
      const {chmodSync, mkdtempSync, rmSync, writeFileSync} = await import(
        'node:fs'
      )
      const {tmpdir} = await import('node:os')
      const {join} = await import('node:path')
      const dir = mkdtempSync(join(tmpdir(), 'extjs-run-only-pin-'))
      const pin = join(dir, 'canary')
      writeFileSync(pin, '#!/bin/sh\necho "Canary 999.0.1234.5"\n')
      chmodSync(pin, 0o755)

      try {
        await runOnlyPreviewBrowser({
          browser: 'chrome',
          outPath: EXT,
          contextDir: scratch,
          extensionsToLoad: [EXT],
          chromiumBinary: pin
        })

        expect(printProdBannerOnce).toHaveBeenCalledWith(
          expect.objectContaining({
            browser: 'chrome',
            binaryPath: pin,
            binaryProvenance: 'pinned',
            browserVersionLine: '999.0.1234.5'
          })
        )
      } finally {
        rmSync(dir, {recursive: true, force: true})
      }
    }
  )

  // A bare script has no app bundle metadata, so only asking the binary
  // itself names its version. Without that the card named another install.
  for (const browser of ['firefox', 'waterfox'] as const) {
    it.skipIf(process.platform === 'win32')(
      `describes a ${browser} --gecko-binary pin on the card`,
      async () => {
        const {chmodSync, mkdtempSync, rmSync, writeFileSync} = await import(
          'node:fs'
        )
        const {tmpdir} = await import('node:os')
        const {join} = await import('node:path')
        const dir = mkdtempSync(join(tmpdir(), 'extjs-run-only-gecko-pin-'))
        const pin = join(dir, 'firefox')
        writeFileSync(pin, '#!/bin/sh\necho "Mozilla Firefox 140.0"\n')
        chmodSync(pin, 0o755)

        try {
          await runOnlyPreviewBrowser({
            browser,
            outPath: EXT_FIREFOX,
            contextDir: scratch,
            extensionsToLoad: [EXT_FIREFOX],
            geckoBinary: pin
          })

          expect(printProdBannerOnce).toHaveBeenCalledWith(
            expect.objectContaining({
              browser,
              binaryPath: pin,
              binaryProvenance: 'pinned',
              browserVersionLine: '140.0'
            })
          )
        } finally {
          rmSync(dir, {recursive: true, force: true})
        }
      }
    )
  }

  it.skipIf(process.platform === 'win32')(
    'keeps a silent --gecko-binary pin marked pinned so no other install is named',
    async () => {
      const {chmodSync, mkdtempSync, rmSync, writeFileSync} = await import(
        'node:fs'
      )
      const {tmpdir} = await import('node:os')
      const {join} = await import('node:path')
      const dir = mkdtempSync(join(tmpdir(), 'extjs-run-only-gecko-quiet-'))
      const pin = join(dir, 'firefox')
      writeFileSync(pin, '#!/bin/sh\nexit 0\n')
      chmodSync(pin, 0o755)

      try {
        await runOnlyPreviewBrowser({
          browser: 'firefox',
          outPath: EXT_FIREFOX,
          contextDir: scratch,
          extensionsToLoad: [EXT_FIREFOX],
          geckoBinary: pin
        })

        expect(printProdBannerOnce).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: pin,
            binaryProvenance: 'pinned',
            browserVersionLine: undefined
          })
        )
      } finally {
        rmSync(dir, {recursive: true, force: true})
      }
    }
  )

  it('prints the card before it launches chromium', async () => {
    await runOnlyPreviewBrowser({
      browser: 'chromium',
      outPath: EXT,
      contextDir: scratch,
      extensionsToLoad: [EXT]
    })

    expect(printProdBannerOnce.mock.invocationCallOrder[0]).toBeLessThan(
      chromiumRunOnce.mock.invocationCallOrder[0]
    )
  })

  // The gecko install verifies through the banner's nameability verdict, so
  // printing the card first no longer reports a healthy install as failed.
  it('prints the card before it launches firefox', async () => {
    await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: EXT_FIREFOX,
      contextDir: scratch,
      extensionsToLoad: [EXT_FIREFOX]
    })

    expect(printProdBannerOnce.mock.invocationCallOrder[0]).toBeLessThan(
      firefoxRunOnce.mock.invocationCallOrder[0]
    )
  })

  it('prints production banner for firefox preview', async () => {
    await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: EXT_FIREFOX,
      contextDir: scratch,
      extensionsToLoad: [EXT_FIREFOX]
    })

    expect(firefoxRunOnce).toHaveBeenCalledTimes(1)
    expect(firefoxRunOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mode: 'production',
          context: scratch,
          output: {path: EXT_FIREFOX}
        }),
        errors: []
      }),
      expect.objectContaining({
        browser: 'firefox',
        mode: 'production',
        profile: undefined,
        persistProfile: undefined,
        geckoBinary: undefined
      })
    )

    expect(printProdBannerOnce).toHaveBeenCalledWith({
      browser: 'firefox',
      outPath: EXT_FIREFOX,
      includeExtensionId: true,
      includeRunId: false,
      readyPath: undefined,
      browserVersionLine: undefined
    })
  })

  // A start session's broker wakes a suspended event page the way dev's does,
  // through the debugger connection this launch opened.
  it('hands back a wake for the Firefox background it launched', async () => {
    const wakeBackground = vi.fn(async (_timeoutMs: number) => true)
    createFirefoxContext.mockReturnValueOnce({
      getController: () => ({wakeBackground})
    })

    const session = await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: EXT_FIREFOX,
      contextDir: scratch,
      extensionsToLoad: [EXT_FIREFOX]
    })

    await expect(session?.wakeBackground?.()).resolves.toBe(true)
    expect(wakeBackground).toHaveBeenCalledTimes(1)
  })

  it('answers false for a wake before the debugger is up', async () => {
    createFirefoxContext.mockReturnValueOnce({getController: () => undefined})

    const session = await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: EXT_FIREFOX,
      contextDir: scratch,
      extensionsToLoad: [EXT_FIREFOX]
    })

    await expect(session?.wakeBackground?.()).resolves.toBe(false)
  })

  for (const browser of ['brave', 'opera', 'vivaldi', 'yandex'] as const) {
    it(`routes the chromium fork ${browser} to the chromium launcher`, async () => {
      await runOnlyPreviewBrowser({
        browser,
        outPath: EXT,
        contextDir: scratch,
        extensionsToLoad: [EXT]
      })

      expect(chromiumRunOnce).toHaveBeenCalledTimes(1)
      expect(firefoxRunOnce).not.toHaveBeenCalled()
    })
  }

  for (const browser of ['waterfox', 'librewolf', 'zen', 'floorp'] as const) {
    it(`routes the gecko fork ${browser} to the firefox launcher`, async () => {
      await runOnlyPreviewBrowser({
        browser,
        outPath: EXT,
        contextDir: scratch,
        extensionsToLoad: [EXT]
      })

      expect(firefoxRunOnce).toHaveBeenCalledTimes(1)
      expect(chromiumRunOnce).not.toHaveBeenCalled()
    })
  }
})

// A preview started while a dev session owns the same record writes nothing to
// it, so the preview's launcher has no run of its own on that record.
describe('a preview launched over a live dev session', () => {
  let dir: string
  let devSession: ChildProcess
  let readyPath: string
  let outPath: string
  let devRecord: string

  beforeEach(async () => {
    chromiumRunOnce.mockReset()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-only-two-'))
    outPath = path.join(dir, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"two"}')
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'two', version: '1.0.0'})
    )

    // The first session: a stand-in process this spec spawned and ends.
    devSession = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore'
      }
    )

    readyPath = path.join(dir, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    devRecord = JSON.stringify({
      schemaVersion: 2,
      command: 'dev',
      browser: 'chrome',
      status: 'ready',
      runId: 'dev-run',
      pid: devSession.pid,
      distPath: outPath,
      cdpPort: 9222,
      ts: '2026-01-01T00:00:00.000Z'
    })

    fs.writeFileSync(readyPath, devRecord)

    // The engine's half: the preview writer leaves the dev record alone.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: dir,
      browser: 'chrome',
      command: 'preview',
      distPath: outPath,
      manifestPath: path.join(outPath, 'manifest.json'),
      port: null
    })
    expect(writer.readyPath).toBe(readyPath)
    writer.writeStarting()
    warn.mockRestore()
    expect(fs.readFileSync(readyPath, 'utf8')).toBe(devRecord)
  })

  afterEach(() => {
    devSession.kill()
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('leaves the dev record as it was when the preview browser comes up', async () => {
    await runOnlyPreviewBrowser({
      browser: 'chrome',
      outPath,
      readyPath,
      contextDir: dir,
      extensionsToLoad: [outPath]
    })

    const launch = chromiumRunOnce.mock.calls[0] as unknown as [
      unknown,
      {debugPortClaim?: {release(): void}}
    ]
    launch[1].debugPortClaim?.release()

    expect(fs.readFileSync(readyPath, 'utf8')).toBe(devRecord)
  })

  it('leaves the dev record as it was when the preview launch fails', async () => {
    chromiumRunOnce.mockImplementationOnce(async () => {
      throw new Error('spawn EACCES')
    })

    await expect(
      runOnlyPreviewBrowser({
        browser: 'chrome',
        outPath,
        readyPath,
        contextDir: dir,
        extensionsToLoad: [outPath]
      })
    ).rejects.toMatchObject({code: 'E_BROWSER_LAUNCH'})

    expect(fs.readFileSync(readyPath, 'utf8')).toBe(devRecord)
  })
})

describe('the signal listeners of a run-only session', () => {
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  let listenersBefore: Map<string, unknown[]>

  const counts = () => SIGNALS.map((name) => process.listenerCount(name))

  beforeEach(() => {
    chromiumRunOnce.mockClear()
    firefoxRunOnce.mockClear()
    listenersBefore = new Map(
      SIGNALS.map((name) => [name, process.listeners(name)])
    )
  })

  afterEach(() => {
    for (const name of SIGNALS) {
      for (const listener of process.listeners(name)) {
        if (!listenersBefore.get(name)?.includes(listener)) {
          process.removeListener(name, listener)
        }
      }
    }
  })

  it.each([
    ['chromium', chromiumRunOnce, EXT],
    ['firefox', firefoxRunOnce, EXT_FIREFOX]
  ] as const)('are removed when the %s launch throws', async (browser, runOnce, outPath) => {
    const before = counts()
    runOnce.mockRejectedValueOnce(new Error('the launch failed'))

    const error = await runOnlyPreviewBrowser({
      browser,
      outPath,
      contextDir: scratch,
      extensionsToLoad: [outPath]
    }).then(
      () => null,
      (reason: Error & {code?: string}) => reason
    )

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(error?.code).toBe('E_BROWSER_LAUNCH')
    expect(counts()).toEqual(before)
  })

  it('stay for the session once the launch returns, one of each', async () => {
    const before = counts()

    await runOnlyPreviewBrowser({
      browser: 'chromium',
      outPath: EXT,
      contextDir: scratch,
      extensionsToLoad: [EXT]
    })

    expect(chromiumRunOnce).toHaveBeenCalledTimes(1)
    expect(counts()).toEqual(before.map((count) => count + 1))
  })

  it('stay one of each when the process runs a second session', async () => {
    const before = counts()

    for (const browser of ['chromium', 'firefox'] as const) {
      await runOnlyPreviewBrowser({
        browser,
        outPath: browser === 'chromium' ? EXT : EXT_FIREFOX,
        contextDir: scratch,
        extensionsToLoad: [browser === 'chromium' ? EXT : EXT_FIREFOX]
      })
    }

    expect(counts()).toEqual(before.map((count) => count + 1))
  })

  describe('on a signal', () => {
    let exit: ReturnType<typeof vi.spyOn>

    // The listener this session added, called alone: emitting the signal
    // would also run every other handler in the test process.
    const signal = (name: (typeof SIGNALS)[number]) => {
      const added = process
        .listeners(name)
        .filter((listener) => !listenersBefore.get(name)?.includes(listener))

      expect(added).toHaveLength(1)
      ;(added[0] as () => void)()
    }

    const session = (browser: 'chromium' | 'firefox') => {
      const outPath = browser === 'chromium' ? EXT : EXT_FIREFOX

      return runOnlyPreviewBrowser({
        browser,
        outPath,
        contextDir: scratch,
        extensionsToLoad: [outPath]
      })
    }

    beforeEach(() => {
      launched.spawned = true
      launched.closed = false
      exit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never)
    })

    afterEach(() => {
      vi.useRealTimers()
      launched.spawned = false
      launched.closed = false
    })

    it.each([
      'chromium',
      'firefox'
    ] as const)('exits once the %s browser has closed, not before', async (browser) => {
      await session(browser)
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})

      signal('SIGINT')
      vi.advanceTimersByTime(2000)
      expect(exit).not.toHaveBeenCalled()

      launched.closed = true
      vi.advanceTimersByTime(100)
      expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('exits after the stop grace period when the browser never closes', async () => {
      await session('chromium')
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})

      signal('SIGTERM')
      vi.advanceTimersByTime(5000)
      expect(exit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1000)
      expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('exits at once on a second signal', async () => {
      await session('chromium')
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})

      signal('SIGINT')
      vi.advanceTimersByTime(100)
      expect(exit).not.toHaveBeenCalled()

      signal('SIGINT')
      expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('exits at once when no browser was started', async () => {
      launched.spawned = false
      await session('chromium')
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})

      signal('SIGHUP')
      vi.advanceTimersByTime(50)
      expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    })
  })
})

describe('warnIgnoredHostPermissionPatterns', () => {
  const writeManifest = (hostPermissions: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-only-hosts-'))

    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, host_permissions: hostPermissions})
    )

    return dir
  }

  const printed = (opts: {outPath: string; command?: 'preview' | 'start'}) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    warnIgnoredHostPermissionPatterns(opts)

    const text = [spy, warn, log]
      .flatMap((each) => each.mock.calls.map((call) => call.join(' ')))
      .join('\n')

    spy.mockRestore()
    warn.mockRestore()
    log.mockRestore()

    return text
  }

  it('warns before a preview launch and does not call it a refusal', () => {
    const text = printed({outPath: writeManifest(['https://foo.*.com/*'])})

    expect(text).toContain('host permission patterns the browser drops')
    expect(text).toContain('https://foo.*.com/*')
    expect(text).not.toMatch(/refuses|won't load/)
  })

  it('stays quiet for valid patterns, a missing manifest, and start', () => {
    expect(printed({outPath: writeManifest(['https://*.foo.com/*'])})).toBe('')
    expect(printed({outPath: '/nonexistent/run-only-hosts'})).toBe('')
    expect(
      printed({
        outPath: writeManifest(['https://foo.*.com/*']),
        command: 'start'
      })
    ).toBe('')
  })
})
