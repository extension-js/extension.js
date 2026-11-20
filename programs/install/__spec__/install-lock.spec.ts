import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {LockSeams} from '../lib/install-lock'
import {PUPPETEER_BROWSERS_VERSION} from '../lib/installer-versions'
import {type CommandResult, runCommand} from '../lib/runner'
import {
  BrowserInstallBusyError,
  BrowserInstallerNotFoundError,
  BrowserInstallFailedError,
  BrowserInstallForeignFolderError,
  BrowserInstallTimeoutError,
  BrowserUninstallError,
  extensionInstall,
  extensionUninstall,
  getManagedBrowsersCacheRoot,
  type InstallOptions,
  isBrowserCacheRootError,
  isBrowserInstallBusyError,
  isBrowserInstallFailedError,
  isBrowserInstallForeignFolderError,
  isBrowserInstallTimeoutError,
  type UninstallOptions
} from '../module'

// Every cache root is made under here. The process is pointed at guardRoot
// and an empty PATH, so a lost injection reaches no real runner or cache.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-lock-'))
const project = path.join(scratch, 'project')
const emptyBin = path.join(scratch, 'empty-bin')
const guardRoot = path.join(scratch, 'guard-cache')
fs.mkdirSync(project)
fs.mkdirSync(emptyBin)

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

const PNPM = 'pnpm/10.28.0 npm/? node/v23.8.0'
const MARKER = '.extension-install.json'
const HALF_HOUR = 30 * 60_000
const MAC_EDGE =
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const NOT_OURS = "it holds files Extension.js didn't put there"
const NOT_OURS_REMEDY =
  'Extension.js removes only the folders it installed, ' +
  'so delete that one yourself if you mean to.'

function never(): never {
  throw new Error('this case must not ask the system for Edge')
}

function ending(result: Partial<CommandResult> = {}): CommandResult {
  return {code: 0, signal: null, stdout: '', stderr: '', ...result}
}

function tree(dir: string): string[] {
  return fs
    .readdirSync(dir, {recursive: true})
    .map((entry) => String(entry).split(path.sep).join('/'))
    .sort()
}

// Every file under dir with its content, to show nothing in it changed.
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {}

  for (const entry of tree(dir)) {
    const file = path.join(dir, entry)

    files[entry] = fs.statSync(file).isDirectory()
      ? '<folder>'
      : fs.readFileSync(file, 'utf8')
  }

  return files
}

// A sleep that never yields starves the timers, so a lock that is never
// released would spin where the test should fail.
function turn(): Promise<void> {
  return new Promise((done) => setImmediate(done))
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}

  const promise = new Promise<T>((done) => {
    resolve = done
  })

  return {promise, resolve}
}

describe('one install per browser folder, and no delete of a folder that is not ours', () => {
  let cacheRoot = ''
  let logged: string[] = []
  let warned: string[] = []
  let exitListeners = 0

  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(scratch, 'cache-'))
    logged = []
    warned = []
    exitListeners = process.listenerCount('exit')
    vi.stubEnv('PATH', emptyBin)
    vi.stubEnv('EXT_BROWSERS_CACHE_DIR', guardRoot)
    vi.stubEnv('EXTENSION_OUTPUT', '')
    vi.spyOn(console, 'log').mockImplementation((line) => {
      logged.push(stripVTControlCharacters(String(line)))
    })

    vi.spyOn(console, 'warn').mockImplementation((line) => {
      warned.push(stripVTControlCharacters(String(line)))
    })

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(process.env.PATH).toBe(emptyBin)
    expect(fs.readdirSync(emptyBin)).toEqual([])
    expect(getManagedBrowsersCacheRoot()).toBe(guardRoot)
    expect(path.dirname(cacheRoot)).toBe(scratch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    expect(fs.existsSync(guardRoot)).toBe(false)
    expect(process.listenerCount('exit')).toBe(exitListeners)
  })

  const at = (browser: string) => path.join(cacheRoot, browser)
  const lockOf = (browser: string) => path.join(cacheRoot, `.${browser}.lock`)
  const ownerOf = (browser: string) =>
    JSON.parse(
      fs.readFileSync(path.join(lockOf(browser), 'owner.json'), 'utf8')
    ) as {pid: number; id: string; startedAt: string; timeoutMs: number}

  function env(extra: Record<string, string | undefined> = {}) {
    return {
      EXT_BROWSERS_CACHE_DIR: cacheRoot,
      PATH: emptyBin,
      npm_config_user_agent: PNPM,
      ...extra
    }
  }

  function install(options: Partial<InstallOptions> = {}): Promise<unknown> {
    return extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => null,
      runInstaller: async () => ending(),
      env: env(),
      platform: 'linux',
      cwd: project,
      stdinIsTTY: true,
      isRoot: false,
      systemEdge: {exists: never, lookup: never, registry: never},
      ...options
    }).then(
      () => 'installed',
      (thrown: unknown) => thrown
    )
  }

  function uninstall(options: UninstallOptions): Promise<unknown> {
    return extensionUninstall({
      env: env(),
      platform: 'darwin',
      systemEdge: {exists: () => false, lookup: never, registry: never},
      ...options
    }).catch((thrown: unknown) => thrown)
  }

  function plantBuild(browser: string): string {
    const build = path.join(at(browser), 'mac_arm-152.0.9999.1')
    fs.mkdirSync(build, {recursive: true})
    const binary = path.join(build, 'browser-stub')
    fs.writeFileSync(binary, 'stub')

    return binary
  }

  function plantLock(
    browser: string,
    owner: {pid: number; startedAt?: string; timeoutMs?: number} | null
  ) {
    fs.mkdirSync(lockOf(browser), {recursive: true})

    if (owner) {
      fs.writeFileSync(
        path.join(lockOf(browser), 'owner.json'),
        JSON.stringify({
          id: 'another-run',
          startedAt: new Date().toISOString(),
          timeoutMs: HALF_HOUR,
          ...owner
        })
      )
    }
  }

  // A clock that moves only when the lock sleeps, so a wait of half an hour
  // takes no time.
  function clock(start = Date.now()) {
    let now = start
    const slept: number[] = []
    const seams: LockSeams = {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms)
        now += ms
      }
    }

    return {seams, slept, advance: (ms: number) => (now += ms)}
  }

  // The Chrome profile folder of a real application folder, built from
  // nothing here, as EXT_BROWSERS_CACHE_DIR pointed at such a folder finds it.
  function plantProfile(): Record<string, string> {
    fs.mkdirSync(path.join(at('chrome'), 'Default'), {recursive: true})
    fs.writeFileSync(
      path.join(at('chrome'), 'Default', 'Preferences'),
      '{"profile":{"name":"Person 1"}}'
    )

    fs.writeFileSync(path.join(at('chrome'), 'Local State'), '{"os_crypt":{}}')

    return snapshot(cacheRoot)
  }

  describe('the lock an install holds', () => {
    it('holds a lock folder beside the destination while the installer runs, and removes it after', async () => {
      let seen: ReturnType<typeof ownerOf> | undefined
      const binary = plantBuild('chrome')
      const before = Date.now()

      expect(
        await install({
          locateInstalledBinary: () => binary,
          runInstaller: async () => {
            seen = ownerOf('chrome')
            expect(fs.readdirSync(lockOf('chrome'))).toEqual(['owner.json'])
            expect(process.listenerCount('exit')).toBe(exitListeners + 1)

            return ending()
          }
        })
      ).toBe('installed')

      expect(seen?.pid).toBe(process.pid)
      expect(seen?.timeoutMs).toBe(HALF_HOUR)
      expect(seen?.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(Date.parse(String(seen?.startedAt))).toBeGreaterThanOrEqual(before)
      expect(fs.existsSync(lockOf('chrome'))).toBe(false)
      expect(tree(cacheRoot)).toEqual([
        'chrome',
        `chrome/${MARKER}`,
        'chrome/mac_arm-152.0.9999.1',
        'chrome/mac_arm-152.0.9999.1/browser-stub'
      ])
    })

    it.each<{
      path: string
      runInstaller: InstallOptions['runInstaller']
      thrown: new (...args: never[]) => Error
    }>([
      {
        path: 'the installer fails',
        runInstaller: async () => ending({code: 7}),
        thrown: BrowserInstallFailedError
      },
      {
        path: 'the installer leaves no browser',
        runInstaller: async () => ending(),
        thrown: BrowserInstallFailedError
      },
      {
        path: 'the installer times out',
        runInstaller: async () =>
          ending({code: null, signal: 'SIGTERM', timedOut: true}),
        thrown: BrowserInstallTimeoutError
      },
      {
        path: 'the runner is not there to start',
        runInstaller: async () => {
          throw Object.assign(new Error('spawn pnpm ENOENT'), {code: 'ENOENT'})
        },
        thrown: BrowserInstallerNotFoundError
      },
      {
        path: 'the runner throws anything else',
        runInstaller: async () => {
          throw new RangeError('unexpected')
        },
        thrown: RangeError
      }
    ])('releases the lock when $path, and leaves nothing in the root', async ({
      runInstaller,
      thrown
    }) => {
      const held: boolean[] = []

      const error = await install({
        runInstaller: async (...args) => {
          held.push(fs.existsSync(lockOf('chrome')))

          return (runInstaller as typeof runCommand)(...args)
        }
      })

      expect(error).toBeInstanceOf(thrown)
      expect(held).toEqual([true])
      expect(tree(cacheRoot)).toEqual([])
    })

    it('makes a second install of the same browser wait, then reports the browser the first one left', async () => {
      const binary = path.join(at('chrome'), 'mac_arm-152.0.9999.1', 'chrome')
      const firstRunner = deferred<CommandResult>()
      const firstStarted = deferred<void>()
      const locateInstalledBinary = () =>
        fs.existsSync(binary) ? binary : null

      const first = install({
        locateInstalledBinary,
        runInstaller: async () => {
          firstStarted.resolve()

          return firstRunner.promise
        }
      })
      await firstStarted.promise

      const secondRunner = vi.fn(async () => ending())
      const slept: number[] = []
      const second = install({
        locateInstalledBinary,
        runInstaller: secondRunner,
        lock: {
          // The first install finishes while the second one sleeps.
          sleep: async (ms) => {
            slept.push(ms)
            plantBuild('chrome')
            fs.renameSync(
              path.join(path.dirname(binary), 'browser-stub'),
              binary
            )

            firstRunner.resolve(ending())
            await first
            await turn()
          }
        }
      })

      expect(await second).toBe('installed')
      expect(await first).toBe('installed')
      expect(secondRunner).not.toHaveBeenCalled()
      expect(slept).toEqual([250])
      expect(logged).toEqual([
        `⏵⏵⏵ Installing Chrome…\nPATH ${at('chrome')}`,
        `⏵⏵⏵ Another install of Chrome is running (PID ${process.pid}). Waiting for it to finish…`,
        `⏵⏵⏵ Chrome is installed.\nPATH ${at('chrome')}`,
        `⏵⏵⏵ Chrome is installed.\nPATH ${at('chrome')}`
      ])

      expect(fs.existsSync(lockOf('chrome'))).toBe(false)
    })

    it('installs for itself after the wait when the first install failed', async () => {
      const firstRunner = deferred<CommandResult>()
      const firstStarted = deferred<void>()
      const first = install({
        runInstaller: async () => {
          firstStarted.resolve()

          return firstRunner.promise
        }
      })
      await firstStarted.promise

      const binary = path.join(at('chrome'), 'mac_arm-152.0.9999.1', 'chrome')
      const secondRunner = vi.fn(async () => {
        expect(ownerOf('chrome').pid).toBe(process.pid)
        fs.mkdirSync(path.dirname(binary), {recursive: true})
        fs.writeFileSync(binary, 'stub')

        return ending()
      })
      const second = install({
        locateInstalledBinary: () => (fs.existsSync(binary) ? binary : null),
        runInstaller: secondRunner,
        lock: {
          sleep: async () => {
            firstRunner.resolve(ending({code: 7}))
            await first
            await turn()
          }
        }
      })

      expect(await second).toBe('installed')
      expect(await first).toBeInstanceOf(BrowserInstallFailedError)
      expect(secondRunner).toHaveBeenCalledTimes(1)
      expect(fs.existsSync(binary)).toBe(true)
      expect(fs.existsSync(lockOf('chrome'))).toBe(false)
    })

    // A root user writes into a read-only folder, so the case cannot run as one.
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'names a root it cannot write the lock into, before any installer starts',
      async () => {
        const runInstaller = vi.fn(async () => ending())
        fs.chmodSync(cacheRoot, 0o555)

        const error = await install({runInstaller}).finally(() =>
          fs.chmodSync(cacheRoot, 0o755)
        )

        expect(isBrowserCacheRootError(error)).toBe(true)
        expect((error as Error).message).toBe(
          `Couldn't install Chrome. The browser cache path ${cacheRoot} ` +
            "can't be written (EACCES). Remove what is at that path, or set " +
            'EXT_BROWSERS_CACHE_DIR to a folder Extension.js can write to.'
        )

        expect((error as {cause?: NodeJS.ErrnoException}).cause?.code).toBe(
          'EACCES'
        )

        expect(runInstaller).not.toHaveBeenCalled()
        expect(logged).toEqual([])
        expect(tree(cacheRoot)).toEqual([])
      }
    )

    it('lets two different browsers install at the same time', async () => {
      const chromeRunner = deferred<CommandResult>()
      const chromeStarted = deferred<void>()
      const chrome = install({
        runInstaller: async () => {
          chromeStarted.resolve()

          return chromeRunner.promise
        }
      })
      await chromeStarted.promise

      const sleep = vi.fn(async () => {})
      const firefox = await install({browser: 'firefox', lock: {sleep}})

      expect(firefox).toBeInstanceOf(BrowserInstallFailedError)
      expect(sleep).not.toHaveBeenCalled()
      chromeRunner.resolve(ending())
      await chrome
    })

    it.each<{
      name: string
      owner: {pid: number; timeoutMs?: number}
      isAlive: () => boolean
      age: number
    }>([
      {
        name: 'whose pid is dead',
        owner: {pid: 4_000_000},
        isAlive: () => false,
        age: 0
      },
      {
        name: 'whose pid is alive but which outlived its own timeout',
        owner: {pid: 4_000_000, timeoutMs: 1000},
        isAlive: () => true,
        age: 1000 + 60_001
      }
    ])('takes over a lock $name, without waiting', async ({
      owner,
      isAlive,
      age
    }) => {
      const {seams, slept} = clock()
      plantLock('chrome', {
        ...owner,
        startedAt: new Date((seams.now as () => number)() - age).toISOString()
      })

      const runInstaller = vi.fn(async () => {
        expect(ownerOf('chrome').pid).toBe(process.pid)

        return ending()
      })

      expect(
        await install({runInstaller, lock: {...seams, isAlive}})
      ).toBeInstanceOf(BrowserInstallFailedError)

      expect(runInstaller).toHaveBeenCalledTimes(1)
      expect(slept).toEqual([])
      expect(logged.join('\n')).not.toContain('Waiting')
      expect(tree(cacheRoot)).toEqual([])
    })

    it('waits out a live lock for the whole timeout, then fails as busy and touches nothing', async () => {
      const {seams, slept} = clock()
      const binary = plantBuild('chrome')
      plantLock('chrome', {pid: 4_000_000})
      const lockBefore = snapshot(lockOf('chrome'))
      const runInstaller = vi.fn(async () => ending())

      const error = await install({
        runInstaller,
        env: env({EXTENSION_INSTALL_TIMEOUT_MS: '1000'}),
        lock: {...seams, isAlive: () => true, pollMs: 400}
      })

      expect(error).toBeInstanceOf(BrowserInstallBusyError)
      expect((error as Error).name).toBe('BrowserInstallBusyError')
      expect((error as BrowserInstallBusyError).code).toBe(
        'BROWSER_INSTALL_BUSY'
      )

      expect(isBrowserInstallBusyError(error)).toBe(true)
      expect((error as Error).message).toBe(
        "Couldn't install Chrome. Another install of Chrome (PID 4000000) " +
          'was still running after 1 second. Wait for it to finish and run ' +
          `the install again, or delete ${lockOf('chrome')} when no such ` +
          'install is running.'
      )

      expect(slept).toEqual([400, 400, 400])
      expect(runInstaller).not.toHaveBeenCalled()
      expect(logged).toEqual([
        '⏵⏵⏵ Another install of Chrome is running (PID 4000000). Waiting for it to finish…'
      ])

      expect(snapshot(lockOf('chrome'))).toEqual(lockBefore)
      expect(fs.existsSync(binary)).toBe(true)
      expect(fs.existsSync(path.join(at('chrome'), MARKER))).toBe(false)
    })

    it('waits on a fresh lock with no owner yet, and takes over one left that way for ten seconds', async () => {
      const {seams, slept, advance} = clock()
      plantLock('chrome', null)

      const fresh = await install({
        env: env({EXTENSION_INSTALL_TIMEOUT_MS: '500'}),
        lock: seams
      })

      expect(fresh).toBeInstanceOf(BrowserInstallBusyError)
      expect((fresh as Error).message).toContain(
        'Another install of Chrome was still running after 500 ms.'
      )

      expect(slept).toEqual([250, 250])
      expect(fs.readdirSync(lockOf('chrome'))).toEqual([])

      advance(10_001)

      expect(await install({lock: seams})).toBeInstanceOf(
        BrowserInstallFailedError
      )

      expect(tree(cacheRoot)).toEqual([])
    })

    // The wait ends, another run takes the lock over, and then this run fails.
    it('deletes nothing once another run holds the lock, and leaves that lock in place', async () => {
      plantBuild('chrome')
      const removeTree = vi.fn()

      const error = await install({
        removeTree,
        runInstaller: async () => {
          fs.writeFileSync(
            path.join(lockOf('chrome'), 'owner.json'),
            JSON.stringify({
              pid: 4_000_000,
              id: 'another-run',
              startedAt: new Date().toISOString(),
              timeoutMs: HALF_HOUR
            })
          )

          return ending({code: 7})
        }
      })

      expect(error).toBeInstanceOf(BrowserInstallFailedError)
      expect((error as Error).message).not.toContain('removed')
      expect(removeTree).not.toHaveBeenCalled()
      expect(ownerOf('chrome').id).toBe('another-run')
      expect(tree(at('chrome'))).toEqual([
        MARKER,
        'mac_arm-152.0.9999.1',
        'mac_arm-152.0.9999.1/browser-stub'
      ])
    })
  })

  describe('an installer that is stopped', () => {
    it('hands the runner the timeout from the injected env, and thirty minutes for a value that is no number', async () => {
      const runInstaller = vi.fn(async () => ending())

      await install({
        runInstaller,
        env: env({EXTENSION_INSTALL_TIMEOUT_MS: '45000'})
      })

      await install({
        runInstaller,
        env: env({EXTENSION_INSTALL_TIMEOUT_MS: '30s'})
      })

      vi.stubEnv('EXTENSION_INSTALL_TIMEOUT_MS', '77')
      await install({runInstaller})

      expect(
        runInstaller.mock.calls.map(
          (call) =>
            (call as unknown as [string, string[], {timeoutMs: number}])[2]
              .timeoutMs
        )
      ).toEqual([45_000, HALF_HOUR, HALF_HOUR])
    })

    it('throws a timeout error that names the browser, the time and the variable, and discards the tree', async () => {
      plantBuild('chrome')
      const firefox = plantBuild('firefox')

      const error = await install({
        env: env({EXTENSION_INSTALL_TIMEOUT_MS: '500'}),
        runInstaller: async () =>
          ending({code: null, signal: 'SIGKILL', timedOut: true})
      })

      expect(error).toBeInstanceOf(BrowserInstallTimeoutError)
      expect((error as Error).name).toBe('BrowserInstallTimeoutError')
      expect((error as BrowserInstallTimeoutError).code).toBe(
        'BROWSER_INSTALL_TIMEOUT'
      )

      expect((error as BrowserInstallTimeoutError).timeoutMs).toBe(500)
      expect(isBrowserInstallTimeoutError(error)).toBe(true)
      expect(isBrowserInstallFailedError(error)).toBe(false)
      expect((error as Error).message).toBe(
        "Couldn't install Chrome. The installer didn't finish within 500 ms " +
          'and was stopped. The incomplete files were removed. Set ' +
          'EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, ' +
          'then run the install again.'
      )

      expect(fs.existsSync(at('chrome'))).toBe(false)
      expect(fs.existsSync(firefox)).toBe(true)
    })

    it('keeps a browser that still works when a reinstall times out', async () => {
      const binary = plantBuild('chrome')

      const error = await install({
        locateInstalledBinary: () => binary,
        runInstaller: async () =>
          ending({code: null, signal: 'SIGTERM', timedOut: true})
      })

      expect((error as Error).message).toBe(
        "Couldn't install Chrome. The installer didn't finish within 30 " +
          'minutes and was stopped. Set EXTENSION_INSTALL_TIMEOUT_MS to a ' +
          'larger number of milliseconds, then run the install again.'
      )

      expect(fs.existsSync(binary)).toBe(true)
    })

    // The one real child of this file: this node binary, by absolute path,
    // idling until the signal the emitter stands in for is passed on to it.
    it('stops a real installer on SIGINT, discards its tree and releases the lock', async () => {
      const signals = new EventEmitter()
      const destination = at('chrome')
      let pid: number | undefined

      const run = install({
        runInstaller: (_command, _args, options) =>
          runCommand(
            process.execPath,
            [
              '-e',
              'const fs = require("node:fs"); const path = require("node:path"); ' +
                'const build = path.join(process.argv[1], "mac_arm-152.0.9999.1"); ' +
                'fs.mkdirSync(build, {recursive: true}); ' +
                'fs.writeFileSync(path.join(build, "half"), "x"); ' +
                'process.stdout.write(String(process.pid)); ' +
                'setInterval(() => {}, 1000)',
              destination,
              'extjs-install-lock-fixture'
            ],
            {...options, signals, graceMs: 100}
          )
      })

      const deadline = Date.now() + 8_000
      const printed = () =>
        vi
          .mocked(process.stdout.write)
          .mock.calls.map((call) => String(call[0]))
          .join('')

      // The pid is the last thing the fixture does, after its half-made tree.
      while (!/^\d+$/.test(printed())) {
        if (Date.now() > deadline) throw new Error('the fixture never started')

        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      pid = Number(printed())
      expect(
        fs.existsSync(path.join(destination, 'mac_arm-152.0.9999.1', 'half'))
      ).toBe(true)

      expect(fs.existsSync(lockOf('chrome'))).toBe(true)
      signals.emit('SIGINT')

      const error = await run

      expect(error).toBeInstanceOf(BrowserInstallFailedError)
      expect((error as Error).message).toBe(
        "Couldn't install Chrome. The install was interrupted by SIGINT and " +
          'its installer was stopped. The incomplete files were removed. ' +
          'Run the install again.'
      )

      expect(pid).toBeGreaterThan(1)
      expect(() => process.kill(pid as number, 0)).toThrow(/ESRCH/)
      expect(signals.listenerCount('SIGINT')).toBe(0)
      expect(tree(cacheRoot)).toEqual([])
    })
  })

  describe('a folder Extension.js did not make', () => {
    it('refuses to install over a browser profile before anything runs, and changes nothing', async () => {
      const before = plantProfile()
      const runInstaller = vi.fn(async () => ending())
      const removeTree = vi.fn()

      const error = await install({runInstaller, removeTree})

      expect(error).toBeInstanceOf(BrowserInstallForeignFolderError)
      expect((error as Error).name).toBe('BrowserInstallForeignFolderError')
      expect((error as BrowserInstallForeignFolderError).code).toBe(
        'BROWSER_INSTALL_FOREIGN_FOLDER'
      )

      expect(isBrowserInstallForeignFolderError(error)).toBe(true)
      expect(isBrowserCacheRootError(error)).toBe(false)
      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The folder ${at('chrome')} holds files ` +
          "Extension.js didn't put there, so nothing in it was changed. " +
          'Set EXT_BROWSERS_CACHE_DIR to a folder that only Extension.js uses.'
      )

      expect(runInstaller).not.toHaveBeenCalled()
      expect(removeTree).not.toHaveBeenCalled()
      expect(logged).toEqual([])
      expect(snapshot(cacheRoot)).toEqual(before)
    })

    // The folder was free when the install began and a browser made it its
    // profile folder before the installer failed.
    it.each([
      {ending: 'fails', result: {code: 7}},
      {ending: 'leaves no browser', result: {code: 0}},
      {
        ending: 'times out',
        result: {code: null, signal: 'SIGTERM' as const, timedOut: true}
      }
    ])('deletes nothing when the folder holds a profile by the time the installer $ending', async ({
      result
    }) => {
      const removeTree = vi.fn()
      let before: Record<string, string> = {}

      const error = await install({
        removeTree,
        runInstaller: async () => {
          plantProfile()
          before = snapshot(at('chrome'))

          return ending(result)
        }
      })

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(
        /^Couldn't install Chrome\. .+ The folder .+ now holds files Extension\.js didn't put there, so nothing in it was removed\.$/
      )

      expect((error as Error).message).toContain(at('chrome'))
      expect((error as Error).message).not.toContain('files were removed')
      expect(removeTree).not.toHaveBeenCalled()
      expect(fs.readdirSync(cacheRoot)).toEqual(['chrome'])
      expect(snapshot(at('chrome'))).toEqual(before)
      expect(Object.keys(before).sort()).toEqual([
        MARKER,
        'Default',
        'Default/Preferences',
        'Local State'
      ])
    })

    it('deletes nothing when a stray file replaced the marker by the time the installer fails', async () => {
      const removeTree = vi.fn()

      const error = await install({
        removeTree,
        runInstaller: async () => {
          fs.rmSync(path.join(at('chrome'), MARKER))
          fs.writeFileSync(path.join(at('chrome'), 'notes.txt'), 'mine')

          return ending({code: 7})
        }
      })

      expect((error as Error).message).toContain(
        'so nothing in it was removed.'
      )

      expect(removeTree).not.toHaveBeenCalled()
      expect(snapshot(cacheRoot)).toEqual({
        chrome: '<folder>',
        'chrome/notes.txt': 'mine'
      })
    })

    it('reports the profile folder as a failed uninstall target and changes nothing', async () => {
      const before = plantProfile()
      const removeTree = vi.fn()

      const error = await uninstall({browser: 'chrome', removeTree})

      expect(error).toBeInstanceOf(BrowserUninstallError)
      expect((error as BrowserUninstallError).results).toEqual([
        {
          browser: 'chrome',
          removed: false,
          path: at('chrome'),
          outcome: 'failed',
          kind: 'foreign',
          reason: NOT_OURS
        }
      ])

      expect((error as Error).message).toBe(
        `Couldn't remove Chrome. ${at('chrome')} was left untouched ` +
          `(${NOT_OURS}). ${NOT_OURS_REMEDY}`
      )

      expect('cause' in (error as Error)).toBe(false)
      expect(removeTree).not.toHaveBeenCalled()
      expect(snapshot(cacheRoot)).toEqual(before)
    })

    it('leaves the profile folder alone under all, and still removes the browsers that are ours', async () => {
      plantProfile()
      const profile = snapshot(at('chrome'))
      plantBuild('firefox')
      fs.mkdirSync(path.join(at('chromium'), 'chromium', 'mac_arm-1380000'), {
        recursive: true
      })

      fs.writeFileSync(path.join(at('chromium'), 'chromium', '.metadata'), '{}')

      const error = await uninstall({all: true})

      expect(
        (error as BrowserUninstallError).results.map((result) => [
          result.browser,
          result.outcome
        ])
      ).toEqual([
        ['chrome', 'failed'],
        ['chromium', 'removed'],
        ['edge', 'absent'],
        ['firefox', 'removed']
      ])

      expect(snapshot(at('chrome'))).toEqual(profile)
      expect(fs.readdirSync(cacheRoot)).toEqual(['chrome'])
    })

    it('marks the folder on every attempt, and discards a marked tree whatever the installer left in it', async () => {
      const binary = path.join(
        at('chrome'),
        'chrome',
        'mac_arm-152.0.9999.1',
        'chrome'
      )

      expect(
        await install({
          locateInstalledBinary: () => binary,
          runInstaller: async () => {
            expect(
              JSON.parse(
                fs.readFileSync(path.join(at('chrome'), MARKER), 'utf8')
              )
            ).toMatchObject({owner: 'extension-install', browser: 'chrome'})

            fs.mkdirSync(path.dirname(binary), {recursive: true})
            fs.writeFileSync(binary, 'stub')

            return ending()
          }
        })
      ).toBe('installed')

      fs.writeFileSync(
        path.join(at('chrome'), 'chrome', '152.0.9999.1-chrome-mac-arm64.zip'),
        'half an archive'
      )

      const error = await install({runInstaller: async () => ending({code: 7})})

      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The command pnpm dlx ` +
          `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION} install ` +
          `chrome@stable --path ${at('chrome')} failed with exit code 7. ` +
          'Run it yourself to see the full error.'
      )

      expect(tree(cacheRoot)).toEqual([])
    })
  })

  describe('uninstall, which takes the same lock without waiting', () => {
    it('reports a browser being installed as a failed target, removes nothing of it, and goes on to the others', async () => {
      const chrome = plantBuild('chrome')
      plantBuild('firefox')
      const runner = deferred<CommandResult>()
      const started = deferred<void>()
      const running = install({
        locateInstalledBinary: () => chrome,
        runInstaller: async () => {
          started.resolve()

          return runner.promise
        }
      })
      await started.promise
      const removeTree = vi.fn((dir: string) =>
        fs.rmSync(dir, {recursive: true, force: true})
      )

      const error = await uninstall({all: true, removeTree})

      expect(error).toBeInstanceOf(BrowserUninstallError)
      expect((error as BrowserUninstallError).results).toEqual([
        {
          browser: 'chrome',
          removed: false,
          path: at('chrome'),
          outcome: 'failed',
          kind: 'installing',
          reason: `an install of it is running, PID ${process.pid}`
        },
        {
          browser: 'chromium',
          removed: false,
          path: at('chromium'),
          outcome: 'absent'
        },
        {browser: 'edge', removed: false, path: at('edge'), outcome: 'absent'},
        {
          browser: 'firefox',
          removed: true,
          path: at('firefox'),
          outcome: 'removed'
        }
      ])

      expect((error as Error).message).toBe(
        `Couldn't remove Chrome. ${at('chrome')} was left untouched ` +
          `(an install of it is running, PID ${process.pid}). ` +
          'Wait for the install to finish, then run the uninstall again.'
      )

      expect(removeTree.mock.calls).toEqual([[at('firefox')]])
      expect(fs.existsSync(chrome)).toBe(true)
      expect(ownerOf('chrome').pid).toBe(process.pid)

      runner.resolve(ending())
      expect(await running).toBe('installed')
    })

    it('fails the target while an install holds the lock before the folder exists', async () => {
      plantLock('chrome', {pid: 4_000_000})

      const error = await uninstall({
        browser: 'chrome',
        lock: {isAlive: () => true}
      })

      expect((error as BrowserUninstallError).results[0]).toMatchObject({
        outcome: 'failed',
        kind: 'installing',
        reason: 'an install of it is running, PID 4000000'
      })

      expect(ownerOf('chrome').id).toBe('another-run')
    })

    it('takes over a lock whose holder is dead, removes the browser and leaves no lock', async () => {
      plantBuild('chrome')
      plantLock('chrome', {pid: 4_000_000})
      let heldBy: number | undefined

      expect(
        await uninstall({
          browser: 'chrome',
          lock: {isAlive: () => false},
          removeTree: (dir) => {
            heldBy = ownerOf('chrome').pid
            fs.rmSync(dir, {recursive: true, force: true})
          }
        })
      ).toEqual([
        {
          browser: 'chrome',
          removed: true,
          path: at('chrome'),
          outcome: 'removed'
        }
      ])

      expect(heldBy).toBe(process.pid)
      expect(tree(cacheRoot)).toEqual([])
    })

    it('releases the lock when the removal fails', async () => {
      plantBuild('chrome')

      const error = await uninstall({
        browser: 'chrome',
        removeTree: () => {
          throw new Error('EBUSY: resource busy or locked')
        }
      })

      expect((error as Error).message).toBe(
        `Couldn't remove Chrome. ${at('chrome')} is still there ` +
          '(EBUSY: resource busy or locked). Close any browser running ' +
          'from that folder, then run the uninstall again.'
      )

      expect(fs.existsSync(lockOf('chrome'))).toBe(false)
    })

    it('makes no lock and no root for a browser that was never installed', async () => {
      const missing = path.join(cacheRoot, 'never-made')

      expect(
        await uninstall({
          all: true,
          env: env({EXT_BROWSERS_CACHE_DIR: missing})
        })
      ).toHaveLength(4)

      expect(fs.existsSync(missing)).toBe(false)
    })
  })

  describe('Edge, whose installer leaves no browser in the cache', () => {
    function plantLinks() {
      fs.mkdirSync(path.join(at('edge'), '.links'), {recursive: true})
      fs.writeFileSync(
        path.join(
          at('edge'),
          '.links',
          'be96a6f53e7c32e028ee0097338cb0204e28ef43'
        ),
        '/somewhere'
      )
    }

    it('clears a links-only folder quietly and says the system Edge is not removed', async () => {
      plantLinks()

      expect(
        await uninstall({
          browser: 'edge',
          systemEdge: {
            exists: (file) => file === MAC_EDGE,
            lookup: never,
            registry: never
          }
        })
      ).toEqual([
        {
          browser: 'edge',
          removed: false,
          path: at('edge'),
          outcome: 'system',
          systemPath: MAC_EDGE
        }
      ])

      expect(logged).toEqual([
        `⏵⏵⏵ Removing the browser binaries for edge…\nPATH ${cacheRoot}`,
        "⏵⏵⏵ Edge is a system install that Extension.js doesn't remove.\n" +
          `PATH ${MAC_EDGE}`
      ])

      expect(tree(cacheRoot)).toEqual([])
    })

    it('clears a links-only folder quietly and says already absent when there is no system Edge', async () => {
      plantLinks()
      fs.writeFileSync(path.join(at('edge'), MARKER), '{}')
      fs.mkdirSync(path.join(at('edge'), '__dirlock'))

      expect(await uninstall({browser: 'edge'})).toEqual([
        {browser: 'edge', removed: false, path: at('edge'), outcome: 'absent'}
      ])

      expect(logged[1]).toBe(`⏵⏵⏵ Edge is already absent.\nPATH ${at('edge')}`)
      expect(logged.join('\n')).not.toContain('is removed')
      expect(tree(cacheRoot)).toEqual([])
    })

    it('says a marker-only folder of any browser was already absent', async () => {
      fs.mkdirSync(at('chrome'))
      fs.writeFileSync(path.join(at('chrome'), MARKER), '{}')

      expect(await uninstall({browser: 'chrome'})).toEqual([
        {
          browser: 'chrome',
          removed: false,
          path: at('chrome'),
          outcome: 'absent'
        }
      ])

      expect(tree(cacheRoot)).toEqual([])
    })

    it('still says removed for a links folder beside a managed Edge', async () => {
      plantLinks()
      plantBuild('edge')

      expect(await uninstall({browser: 'edge'})).toEqual([
        {browser: 'edge', removed: true, path: at('edge'), outcome: 'removed'}
      ])
    })

    // An apt failure after sudo worked: the root switch was announced, and
    // nothing sudo or su printed says the escalation failed.
    it('reports a failure after the root switch as a plain install failure with its real last line', async () => {
      const error = await install({
        browser: 'edge',
        runInstaller: async () =>
          ending({
            code: 1,
            stdout: 'Switching to root user to install dependencies...\n',
            stderr:
              'E: Failed to fetch https://packages.microsoft.com/repos/edge  Temporary failure resolving\n'
          })
      })

      expect(error).toBeInstanceOf(BrowserInstallFailedError)
      expect((error as Error).message).toMatch(
        /failed with exit code 1\. Run it yourself to see the full error\. Its output ended with: E: Failed to fetch https:\/\/packages\.microsoft\.com\/repos\/edge {2}Temporary failure resolving$/
      )

      expect(warned).toEqual([])
    })

    it('says in one warning that the broken tree stayed when it goes on with the system Edge', async () => {
      plantBuild('edge')

      expect(
        await install({
          browser: 'edge',
          removeTree: () => {
            throw new Error('EBUSY')
          },
          runInstaller: async () =>
            ending({code: 1, stderr: 'sudo: a password is required\n'}),
          systemEdge: {
            exists: never,
            lookup: (_tool, name) =>
              name === 'microsoft-edge' ? '/usr/bin/microsoft-edge' : null,
            registry: never
          }
        })
      ).toBe('installed')

      expect(warned).toEqual([
        '⏵⏵⏵ Warning: Skipping the Edge channel install, it needs elevated privileges.\n' +
          'Using the Edge binary already on this system instead.\n' +
          'PATH /usr/bin/microsoft-edge',
        "⏵⏵⏵ Warning: The broken Edge files couldn't be removed.\n" +
          `PATH ${at('edge')}\n` +
          'Delete that folder before the next install.'
      ])
    })

    it('tells the user to pass the binary when only the install can find the Edge it reports', async () => {
      expect(
        await install({
          browser: 'edge',
          systemEdge: {
            exists: never,
            lookup: (_tool, name) =>
              name === 'microsoft-edge-stable'
                ? '/opt/microsoft/msedge/microsoft-edge-stable'
                : null,
            registry: never
          }
        })
      ).toBe('installed')

      expect(logged).toEqual([
        '⏵⏵⏵ Installing Edge system-wide…',
        '⏵⏵⏵ Edge is installed system-wide.\n' +
          'PATH /opt/microsoft/msedge/microsoft-edge-stable\n' +
          'Pass this path with --chromium-binary to run it, ' +
          "since Extension.js doesn't look there on its own."
      ])
    })

    // sudo asks for its password on the terminal, which a child in its own
    // session cannot reach, so only that installer is kept attached.
    it.each([
      {browser: 'edge', platform: 'linux', isRoot: false, attached: true},
      {browser: 'edge', platform: 'darwin', isRoot: false, attached: true},
      {browser: 'edge', platform: 'linux', isRoot: true, attached: false},
      {browser: 'edge', platform: 'win32', isRoot: false, attached: false},
      {browser: 'chrome', platform: 'linux', isRoot: false, attached: false}
    ] as const)('keeps the $browser installer on the terminal on $platform (root: $isRoot): $attached', async ({
      browser,
      platform,
      isRoot,
      attached
    }) => {
      const runInstaller = vi.fn(async () => ending())

      await install({
        browser,
        platform,
        isRoot,
        runInstaller,
        systemEdge: {
          exists: () => false,
          lookup: () => null,
          registry: () => null
        }
      })

      const options = (
        runInstaller.mock.calls[0] as unknown as [string, string[], object]
      )[2]

      expect('ownGroup' in options).toBe(attached)
      expect((options as {ownGroup?: boolean}).ownGroup).toBe(
        attached ? false : undefined
      )

      // Only an installer sudo can prompt for gets a limit on that prompt.
      expect((options as {promptWaitMs?: number}).promptWaitMs).toBe(
        attached ? 5 * 60_000 : undefined
      )
    })

    it('never gives the password prompt longer than the whole install', async () => {
      const runInstaller = vi.fn(async () => ending())

      await install({
        browser: 'edge',
        env: env({EXTENSION_INSTALL_TIMEOUT_MS: '90000'}),
        runInstaller,
        systemEdge: {
          exists: () => false,
          lookup: () => null,
          registry: () => null
        }
      })

      const options = (
        runInstaller.mock.calls[0] as unknown as [string, string[], object]
      )[2]

      expect(options).toMatchObject({
        ownGroup: false,
        timeoutMs: 90_000,
        promptWaitMs: 90_000
      })
    })

    it('takes the Edge the first install placed, after waiting for it', async () => {
      const firstRunner = deferred<CommandResult>()
      const firstStarted = deferred<void>()
      let edgePlaced = false
      const systemEdge = {
        exists: (file: string) => edgePlaced && file === MAC_EDGE,
        lookup: never,
        registry: never
      }
      const first = install({
        browser: 'edge',
        platform: 'darwin',
        systemEdge,
        runInstaller: async () => {
          firstStarted.resolve()

          return firstRunner.promise
        }
      })
      await firstStarted.promise

      const secondRunner = vi.fn(async () => ending())
      const second = install({
        browser: 'edge',
        platform: 'darwin',
        systemEdge,
        runInstaller: secondRunner,
        lock: {
          sleep: async () => {
            edgePlaced = true
            firstRunner.resolve(ending())
            await first
            await turn()
          }
        }
      })

      expect(await second).toBe('installed')
      expect(secondRunner).not.toHaveBeenCalled()
      expect(logged.slice(-1)).toEqual([
        `⏵⏵⏵ Edge is installed system-wide.\nPATH ${MAC_EDGE}`
      ])
    })
  })
})
