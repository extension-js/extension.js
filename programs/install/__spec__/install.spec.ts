import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  PLAYWRIGHT_VERSION,
  PUPPETEER_BROWSERS_VERSION
} from '../lib/installer-versions'
import * as messages from '../lib/messages'
import type {CommandResult, runCommand, SystemEdgeLookup} from '../lib/runner'
import {
  BrowserCacheRootError,
  BrowserInstallerNotFoundError,
  BrowserInstallFailedError,
  BrowserInstallPrivilegeError,
  BrowserNotInstallableError,
  extensionInstall,
  getManagedBrowserInstallDir,
  type InstallOptions
} from '../module'

// Every cache root a case installs into is made under here. The process
// itself is pointed at guardRoot and an empty PATH, see beforeEach.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-'))
const project = path.join(scratch, 'project')
const emptyBin = path.join(scratch, 'empty-bin')
const guardRoot = path.join(scratch, 'guard-cache')
fs.mkdirSync(project)
fs.mkdirSync(emptyBin)

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

const PNPM = 'pnpm/10.28.0 npm/? node/v23.8.0'
const MAC_EDGE =
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const LINUX_EDGE = '/usr/bin/microsoft-edge'
const LAUNCHER_HINT =
  '\nPass this path with --chromium-binary to run it, ' +
  "since Extension.js doesn't look there on its own."
const WINDOWS_EDGE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PRIVILEGE_MESSAGE =
  'Edge needs a privileged interactive session on Linux. ' +
  'Run this command in a terminal where sudo can prompt for credentials, ' +
  'or install Edge system-wide with your package manager ' +
  '(sudo apt install microsoft-edge-stable on Ubuntu and Debian, ' +
  'sudo dnf install microsoft-edge-stable on Fedora) ' +
  'and run Extension.js with --browser=edge. ' +
  'Use --browser=chromium when a privileged install is unavailable.'
const MAC_PRIVILEGE_MESSAGE =
  'Edge needs an administrator password on macOS. ' +
  'Run this command in a terminal where the installer can ask for it, ' +
  'then run Extension.js with --browser=edge. ' +
  'Use --browser=chromium when an administrator password is unavailable.'

function chromeCommand(destination: string): string {
  return (
    `pnpm dlx @puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION} install ` +
    `chrome@stable --path ${destination}`
  )
}

const EDGE_INSTALLING = '⏵⏵⏵ Installing Edge system-wide…'
const EDGE_COMMAND = `pnpm dlx playwright@${PLAYWRIGHT_VERSION} install msedge`

function incomplete(name: string, destination: string, removed: boolean) {
  return (
    `Couldn't install ${name}. The installer finished, but ${destination} ` +
    `holds no ${name} binary that is a non-empty executable file, so the ` +
    `download was likely interrupted. ` +
    (removed ? 'The incomplete files were removed. ' : '') +
    `Run the install again.`
  )
}

function never(): never {
  throw new Error('this case must not ask the system for Edge')
}

const noSystemEdge: SystemEdgeLookup = {
  exists: () => false,
  lookup: () => null,
  registry: () => null
}

function notRemoved(destination: string): string {
  return (
    ` The broken files at ${destination} couldn't be removed. ` +
    `Delete that folder before the next install.`
  )
}

function unusableRoot(name: string, root: string, problem: string): string {
  return (
    `Couldn't install ${name}. The browser cache path ${root} ${problem}. ` +
    `Remove what is at that path, or set EXT_BROWSERS_CACHE_DIR to a folder ` +
    `Extension.js can write to.`
  )
}

function installerEnding(result: Partial<CommandResult>) {
  return vi.fn<typeof runCommand>(async () => ({
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    ...result
  }))
}

function plantTree(cacheRoot: string, browser: string): string {
  const build = path.join(cacheRoot, browser, 'mac_arm-152.0.9999.1')
  fs.mkdirSync(build, {recursive: true})
  const binary = path.join(build, 'browser-stub')
  fs.writeFileSync(binary, '')

  return binary
}

const MARKER = '.extension-install.json'
const HALF_HOUR = 30 * 60_000

function tree(dir: string): string[] {
  return fs
    .readdirSync(dir, {recursive: true})
    .map((entry) => String(entry).split(path.sep).join('/'))
    .sort()
}

function busy(dir: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`EBUSY: resource busy or locked, rmdir '${dir}'`),
    {code: 'EBUSY', syscall: 'rmdir', path: dir}
  )
}

describe('extensionInstall on a temp cache root', () => {
  let cacheRoot = ''
  let logged: string[] = []
  let warned: string[] = []
  let stderr: string[] = []

  // The process fallbacks are a second temp root and a PATH with nothing on
  // it, so a case that lost an injection could neither download nor delete.
  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(scratch, 'cache-'))
    logged = []
    warned = []
    stderr = []
    vi.stubEnv('PATH', emptyBin)
    vi.stubEnv('EXT_BROWSERS_CACHE_DIR', guardRoot)
    vi.stubEnv('EXTENSION_OUTPUT', '')
    vi.spyOn(console, 'log').mockImplementation((line) => {
      logged.push(stripVTControlCharacters(String(line)))
    })

    vi.spyOn(console, 'warn').mockImplementation((line) => {
      warned.push(stripVTControlCharacters(String(line)))
    })

    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(stripVTControlCharacters(String(chunk)))

      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    expect(fs.existsSync(guardRoot)).toBe(false)
  })

  function install(options: Partial<InstallOptions> = {}): Promise<unknown> {
    return extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => null,
      runInstaller: installerEnding({code: 0}),
      env: {
        EXT_BROWSERS_CACHE_DIR: cacheRoot,
        PATH: emptyBin,
        npm_config_user_agent: PNPM
      },
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

  describe('a run that ends well', () => {
    it('runs the plan once and says where the browser is', async () => {
      const binary = plantTree(cacheRoot, 'chrome')
      const destination = path.join(cacheRoot, 'chrome')
      const runInstaller = installerEnding({code: 0})
      const locateInstalledBinary = vi.fn(() => binary)

      expect(await install({runInstaller, locateInstalledBinary})).toBe(
        'installed'
      )

      expect(runInstaller.mock.calls).toEqual([
        [
          'pnpm',
          chromeCommand(destination).split(' ').slice(1),
          {
            cwd: project,
            env: {
              EXT_BROWSERS_CACHE_DIR: cacheRoot,
              PATH: emptyBin,
              npm_config_user_agent: PNPM
            },
            timeoutMs: HALF_HOUR
          }
        ]
      ])

      expect(locateInstalledBinary.mock.calls).toEqual([
        [destination, 'chrome']
      ])

      expect(logged).toEqual([
        `⏵⏵⏵ Installing Chrome…\nPATH ${destination}`,
        `⏵⏵⏵ Chrome is installed.\nPATH ${destination}`
      ])

      expect(warned).toEqual([])
      expect(fs.existsSync(binary)).toBe(true)
    })

    it('says on the first line that an unnamed browser was the default', async () => {
      const binary = plantTree(cacheRoot, 'chromium')

      expect(
        await install({
          browser: 'chromium',
          defaulted: true,
          locateInstalledBinary: () => binary
        })
      ).toBe('installed')

      expect(logged[0]).toBe(
        '⏵⏵⏵ Installing Chromium, the default when no browser is named…\n' +
          `PATH ${path.join(cacheRoot, 'chromium')}`
      )
    })

    it('moves its lines to stderr under machine output', async () => {
      vi.stubEnv('EXTENSION_OUTPUT', 'json')
      const binary = plantTree(cacheRoot, 'chrome')
      const destination = path.join(cacheRoot, 'chrome')

      expect(await install({locateInstalledBinary: () => binary})).toBe(
        'installed'
      )

      expect(logged).toEqual([])
      expect(stderr).toEqual([
        `⏵⏵⏵ Installing Chrome…\nPATH ${destination}\n`,
        `⏵⏵⏵ Chrome is installed.\nPATH ${destination}\n`
      ])
    })

    it('resolves the cache root from the process when no env is given', async () => {
      vi.stubEnv('npm_config_user_agent', PNPM)
      const runInstaller = installerEnding({code: 0})

      const error = await extensionInstall({
        browser: 'firefox',
        locateInstalledBinary: () => null,
        runInstaller
      }).catch((thrown: unknown) => thrown)

      expect((error as Error).message).toBe(
        incomplete('Firefox', path.join(guardRoot, 'firefox'), false)
      )

      expect(runInstaller.mock.calls[0][2].cwd).toBe(process.cwd())
      expect(getManagedBrowserInstallDir('gecko-based')).toBe(
        path.join(guardRoot, 'firefox')
      )

      // The root is made for the lock, and nothing is left in it.
      fs.rmdirSync(guardRoot)
    })
  })

  describe('a run the installer fails', () => {
    it('throws one plain sentence with the last line the installer printed', async () => {
      const destination = path.join(cacheRoot, 'chrome')
      const runInstaller = installerEnding({
        code: 7,
        stderr: 'first line\n\u001b[31mfake npx failure\u001b[0m\n\n'
      })

      const error = await install({runInstaller})

      expect(error).toBeInstanceOf(BrowserInstallFailedError)
      expect((error as Error).name).toBe('BrowserInstallFailedError')
      expect((error as BrowserInstallFailedError).code).toBe(
        'BROWSER_INSTALL_FAILED'
      )

      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The command ${chromeCommand(destination)} ` +
          `failed with exit code 7. Run it yourself to see the full error. ` +
          `Its output ended with: fake npx failure`
      )

      expect(logged).toEqual([`⏵⏵⏵ Installing Chrome…\nPATH ${destination}`])
      expect(tree(cacheRoot)).toEqual([])
    })

    it('names the signal when the installer was killed, and ends there when it printed nothing', async () => {
      const destination = path.join(cacheRoot, 'chrome')

      const error = await install({
        runInstaller: installerEnding({code: null, signal: 'SIGKILL'})
      })

      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The command ${chromeCommand(destination)} ` +
          `was killed by SIGKILL. Run it yourself to see the full error.`
      )
    })

    it('removes the broken tree it leaves, and only that browser', async () => {
      plantTree(cacheRoot, 'chrome')
      const firefox = plantTree(cacheRoot, 'firefox')

      const error = await install({
        runInstaller: installerEnding({code: null, signal: 'SIGKILL'})
      })

      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The command ` +
          `${chromeCommand(path.join(cacheRoot, 'chrome'))} ` +
          `was killed by SIGKILL. Run it yourself to see the full error.`
      )

      expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
      expect(fs.existsSync(firefox)).toBe(true)
    })

    it('keeps an older tree that still works, and still reports the failure', async () => {
      const older = plantTree(cacheRoot, 'chrome')
      const before = tree(cacheRoot)

      const error = await install({
        runInstaller: installerEnding({code: 7}),
        locateInstalledBinary: () => older
      })

      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The command ` +
          `${chromeCommand(path.join(cacheRoot, 'chrome'))} ` +
          `failed with exit code 7. Run it yourself to see the full error.`
      )

      expect(tree(cacheRoot)).toEqual([...before, `chrome/${MARKER}`].sort())
      expect(logged).toHaveLength(1)
    })

    it.each([
      {agent: 'bun/1.3.0 npm/? node/v24.3.0', runner: 'bunx', owner: 'Bun'},
      {agent: PNPM, runner: 'pnpm', owner: 'pnpm'},
      {agent: 'yarn/4.17.1 npm/? node/v24.0.0', runner: 'yarn', owner: 'Yarn'},
      {agent: 'npm/12.0.1 node/v24.0.0', runner: 'npx', owner: 'npm'}
    ])('names $runner when it is not there to start, with the spawn error as the cause', async ({
      agent,
      runner,
      owner
    }) => {
      const binary = plantTree(cacheRoot, 'chrome')
      const spawnError = Object.assign(new Error(`spawn ${runner} ENOENT`), {
        code: 'ENOENT',
        syscall: `spawn ${runner}`
      })

      const error = await install({
        env: {
          EXT_BROWSERS_CACHE_DIR: cacheRoot,
          PATH: emptyBin,
          npm_config_user_agent: agent
        },
        runInstaller: vi.fn(async () => {
          throw spawnError
        })
      })

      expect(error).toBeInstanceOf(BrowserInstallerNotFoundError)
      expect((error as Error).name).toBe('BrowserInstallerNotFoundError')
      expect((error as BrowserInstallerNotFoundError).code).toBe(
        'BROWSER_INSTALLER_NOT_FOUND'
      )

      expect((error as Error).message).toBe(
        `Couldn't install Chrome. The package runner ${runner} wasn't found ` +
          `on this machine. Install ${owner}, or run this command through a ` +
          `package manager that is installed.`
      )

      expect((error as {cause?: unknown}).cause).toBe(spawnError)
      expect(fs.existsSync(binary)).toBe(true)
    })

    it('names the runner without the .cmd Windows adds to it', async () => {
      const error = await install({
        platform: 'win32',
        runInstaller: vi.fn(async () => {
          throw Object.assign(new Error('spawn pnpm.cmd ENOENT'), {
            code: 'ENOENT'
          })
        })
      })

      expect(error).toBeInstanceOf(BrowserInstallerNotFoundError)
      expect((error as Error).message).toContain(
        "The package runner pnpm wasn't found on this machine. Install pnpm,"
      )
    })

    it.each([
      {
        name: 'a spawn that failed for another reason',
        thrown: Object.assign(new Error('spawn pnpm EACCES'), {code: 'EACCES'}),
        cwd: project
      },
      {
        name: 'an ENOENT for a working directory that is gone',
        thrown: Object.assign(new Error('spawn pnpm ENOENT'), {code: 'ENOENT'}),
        cwd: path.join(scratch, 'no-such-project')
      }
    ])('lets $name through as it was thrown', async ({thrown, cwd}) => {
      const error = await install({
        cwd,
        runInstaller: vi.fn(async () => {
          throw thrown
        })
      })

      expect(error).toBe(thrown)
    })
  })

  describe('an installer that exits 0 without leaving a browser', () => {
    it('removes the truncated tree and says so', async () => {
      plantTree(cacheRoot, 'chrome')
      const firefox = plantTree(cacheRoot, 'firefox')
      const destination = path.join(cacheRoot, 'chrome')
      const locateInstalledBinary = vi.fn(() => null)

      const error = await install({locateInstalledBinary})

      expect(error).toBeInstanceOf(BrowserInstallFailedError)
      expect((error as Error).message).toBe(
        incomplete('Chrome', destination, true)
      )

      expect(locateInstalledBinary.mock.calls).toEqual([
        [destination, 'chrome']
      ])

      expect(fs.existsSync(destination)).toBe(false)
      expect(fs.existsSync(firefox)).toBe(true)
      expect(logged).toEqual([`⏵⏵⏵ Installing Chrome…\nPATH ${destination}`])
    })

    it('does not claim a removal when the installer wrote nothing', async () => {
      const error = await install()

      expect((error as Error).message).toBe(
        incomplete('Chrome', path.join(cacheRoot, 'chrome'), false)
      )

      expect(tree(cacheRoot)).toEqual([])
    })
  })

  describe('a tree that cannot be removed', () => {
    it.each([
      {
        ending: 'exits 0 with no binary',
        result: {code: 0},
        failure: (destination: string) =>
          incomplete('Chrome', destination, false)
      },
      {
        ending: 'exits non-zero',
        result: {code: 7, stderr: 'boom\n'},
        failure: (destination: string) =>
          `Couldn't install Chrome. The command ${chromeCommand(destination)} ` +
          `failed with exit code 7. Run it yourself to see the full error. ` +
          `Its output ended with: boom`
      }
    ])('still throws the install failure when the installer $ending, with the removal as its cause', async ({
      result,
      failure
    }) => {
      const binary = plantTree(cacheRoot, 'chrome')
      const destination = path.join(cacheRoot, 'chrome')
      const removalError = busy(destination)
      const removeTree = vi.fn(() => {
        throw removalError
      })

      const error = await install({
        runInstaller: installerEnding(result),
        removeTree
      })

      expect(error).not.toBe(removalError)
      expect((error as Error).name).toBe('BrowserInstallFailedError')
      expect((error as Error).message).toBe(
        failure(destination) + notRemoved(destination)
      )

      expect((error as {cause?: unknown}).cause).toBe(removalError)
      expect(removeTree.mock.calls).toEqual([[destination]])
      expect(fs.existsSync(binary)).toBe(true)
    })

    it('carries no cause when the removal worked', async () => {
      plantTree(cacheRoot, 'chrome')

      const error = await install()

      expect((error as Error).message).toBe(
        incomplete('Chrome', path.join(cacheRoot, 'chrome'), true)
      )

      expect('cause' in (error as Error)).toBe(false)
    })

    it('is never asked to remove a tree that is not there', async () => {
      const removeTree = vi.fn()

      const error = await install({removeTree})

      expect((error as Error).message).toBe(
        incomplete('Chrome', path.join(cacheRoot, 'chrome'), false)
      )

      expect(removeTree).not.toHaveBeenCalled()
    })
  })

  describe('a cache root that cannot be made', () => {
    it.each([
      {runner: 'npx, which starts in it', agent: undefined},
      {runner: 'pnpm, which does not', agent: PNPM}
    ])('names a root that is a file before anything prints, under $runner', async ({
      agent
    }) => {
      const file = path.join(cacheRoot, 'a-file')
      fs.writeFileSync(file, 'not a folder')
      const runInstaller = installerEnding({code: 0})

      const error = await install({
        runInstaller,
        env: {
          EXT_BROWSERS_CACHE_DIR: file,
          PATH: emptyBin,
          npm_config_user_agent: agent
        }
      })

      expect(error).toBeInstanceOf(BrowserCacheRootError)
      expect((error as Error).name).toBe('BrowserCacheRootError')
      expect((error as BrowserCacheRootError).code).toBe('BROWSER_CACHE_ROOT')
      expect((error as Error).message).toBe(
        unusableRoot('Chrome', file, 'is a file, not a folder')
      )

      expect((error as {cause?: NodeJS.ErrnoException}).cause?.code).toBe(
        'EEXIST'
      )

      expect(runInstaller).not.toHaveBeenCalled()
      expect(logged).toEqual([])
      expect(fs.readFileSync(file, 'utf8')).toBe('not a folder')
    })

    it.each([
      {runner: 'npx', agent: undefined},
      {runner: 'pnpm', agent: PNPM}
    ])('names a root that cannot be created under $runner, with the reason and the cause', async ({
      agent
    }) => {
      const file = path.join(cacheRoot, 'a-file')
      const under = path.join(file, 'browsers')
      fs.writeFileSync(file, 'not a folder')
      const runInstaller = installerEnding({code: 0})

      const error = await install({
        runInstaller,
        env: {
          EXT_BROWSERS_CACHE_DIR: under,
          PATH: emptyBin,
          npm_config_user_agent: agent
        }
      })

      expect(error).toBeInstanceOf(BrowserCacheRootError)
      expect((error as Error).message).toBe(
        unusableRoot('Chrome', under, "can't be created (ENOTDIR)")
      )

      expect((error as {cause?: NodeJS.ErrnoException}).cause?.code).toBe(
        'ENOTDIR'
      )

      expect(runInstaller).not.toHaveBeenCalled()
      expect(logged).toEqual([])
    })

    // The lock sits in the root, so the root is made whichever runner runs.
    it.each([
      {runner: 'npx', agent: undefined, startsInRoot: true},
      {runner: 'pnpm', agent: PNPM, startsInRoot: false}
    ])('makes a missing root for $runner and leaves nothing in it after a failed install', async ({
      runner,
      agent,
      startsInRoot
    }) => {
      const missing = path.join(cacheRoot, 'not', 'made', 'yet')
      const runInstaller = installerEnding({code: 0})

      await install({
        runInstaller,
        env: {
          EXT_BROWSERS_CACHE_DIR: missing,
          PATH: emptyBin,
          npm_config_user_agent: agent
        }
      })

      expect(runInstaller.mock.calls[0][0]).toBe(runner)
      expect(runInstaller.mock.calls[0][2].cwd).toBe(
        startsInRoot ? missing : project
      )

      expect(tree(missing)).toEqual([])
    })
  })

  describe('a name that is not a managed browser', () => {
    it('refuses before anything is printed or run', async () => {
      const runInstaller = installerEnding({code: 0})

      const error = await install({browser: 'brave', runInstaller})

      expect(error).toBeInstanceOf(BrowserNotInstallableError)
      expect((error as BrowserNotInstallableError).code).toBe(
        'BROWSER_NOT_INSTALLABLE'
      )

      expect((error as Error).message).toBe(
        'brave cannot be installed by Extension.js. This CLI never downloads ' +
          'it; it is located from the system when present. Managed installs ' +
          'cover: chrome, chromium, edge, firefox, chromium-based, ' +
          'gecko-based, firefox-based.'
      )

      expect(runInstaller).not.toHaveBeenCalled()
      expect(logged).toEqual([])
    })
  })

  describe('Edge, which its installer places system-wide', () => {
    it('accepts exit 0 through the system binary and names that binary, never the cache folder', async () => {
      const destination = path.join(cacheRoot, 'edge')
      const exists = vi.fn((file: string) => file === MAC_EDGE)
      const runInstaller = installerEnding({code: 0})

      expect(
        await install({
          browser: 'edge',
          platform: 'darwin',
          runInstaller,
          systemEdge: {exists, lookup: never, registry: never}
        })
      ).toBe('installed')

      expect(runInstaller.mock.calls[0].slice(0, 2)).toEqual([
        'pnpm',
        EDGE_COMMAND.split(' ').slice(1)
      ])

      expect(runInstaller.mock.calls[0][2].env.PLAYWRIGHT_BROWSERS_PATH).toBe(
        destination
      )

      expect(exists.mock.calls).toEqual([[MAC_EDGE]])
      expect(logged).toEqual([
        EDGE_INSTALLING,
        `⏵⏵⏵ Edge is installed system-wide.\nPATH ${MAC_EDGE}`
      ])

      expect(logged.join('\n')).not.toContain(destination)
      expect(tree(cacheRoot)).toEqual(['edge', `edge/${MARKER}`])
    })

    it('does not ask the system when the locator finds Edge under the destination', async () => {
      const binary = plantTree(cacheRoot, 'edge')
      const destination = path.join(cacheRoot, 'edge')

      expect(
        await install({browser: 'edge', locateInstalledBinary: () => binary})
      ).toBe('installed')

      expect(logged).toEqual([
        EDGE_INSTALLING,
        `⏵⏵⏵ Edge is installed.\nPATH ${destination}`
      ])
    })

    it.each([
      'sudo: a password is required',
      'sudo: a terminal is required to read the password',
      'su: Authentication failure'
    ])('falls back to the system Edge when stderr says "%s", and leaves no broken tree', async (line) => {
      plantTree(cacheRoot, 'edge')
      const lookup = vi.fn((_tool: string, name: string) =>
        name === 'microsoft-edge' ? LINUX_EDGE : null
      )

      expect(
        await install({
          browser: 'edge',
          runInstaller: installerEnding({code: 1, stderr: `${line}\n`}),
          systemEdge: {exists: never, lookup, registry: never}
        })
      ).toBe('installed')

      expect(lookup.mock.calls).toEqual([['which', 'microsoft-edge']])
      expect(warned).toEqual([
        '⏵⏵⏵ Warning: Skipping the Edge channel install, it needs elevated privileges.\n' +
          'Using the Edge binary already on this system instead.\n' +
          `PATH ${LINUX_EDGE}`
      ])

      expect(logged).toEqual([EDGE_INSTALLING])

      expect(tree(cacheRoot)).toEqual([])
    })

    it('keeps a managed Edge that still works on the privilege branch', async () => {
      const managed = plantTree(cacheRoot, 'edge')
      const before = tree(cacheRoot)
      const removeTree = vi.fn()

      const error = await install({
        browser: 'edge',
        locateInstalledBinary: () => managed,
        removeTree,
        runInstaller: installerEnding({
          code: 1,
          stderr: 'sudo: a password is required\n'
        }),
        systemEdge: noSystemEdge
      })

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as Error).message).toBe(PRIVILEGE_MESSAGE)
      expect(removeTree).not.toHaveBeenCalled()
      expect(tree(cacheRoot)).toEqual([...before, `edge/${MARKER}`].sort())
    })

    it('says nothing about the fallback under machine output', async () => {
      vi.stubEnv('EXTENSION_OUTPUT', 'json')

      expect(
        await install({
          browser: 'edge',
          runInstaller: installerEnding({
            code: 1,
            stderr: 'sudo: a password is required\n'
          }),
          systemEdge: {exists: never, lookup: () => LINUX_EDGE, registry: never}
        })
      ).toBe('installed')

      expect(warned).toEqual([])
      expect(stderr).toEqual([`${EDGE_INSTALLING}\n`])
    })

    it('throws the privilege error when sudo failed and no system Edge exists, and leaves no broken tree', async () => {
      plantTree(cacheRoot, 'edge')
      const lookup = vi.fn(() => null)

      const error = await install({
        browser: 'edge',
        runInstaller: installerEnding({
          code: 1,
          stderr: 'sudo: a password is required\n'
        }),
        systemEdge: {exists: never, lookup, registry: never}
      })

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as BrowserInstallPrivilegeError).code).toBe(
        'BROWSER_INSTALL_PRIVILEGE'
      )

      expect((error as Error).message).toBe(PRIVILEGE_MESSAGE)
      expect(lookup.mock.calls).toEqual([
        ['which', 'microsoft-edge'],
        ['which', 'microsoft-edge-stable'],
        ['which', 'msedge']
      ])

      expect(warned).toEqual([])
      expect(tree(cacheRoot)).toEqual([])
    })

    it.each([
      {platform: 'darwin', message: MAC_PRIVILEGE_MESSAGE},
      {platform: 'linux', message: PRIVILEGE_MESSAGE}
    ] as const)('words the privilege error for $platform when sudo had no terminal', async ({
      platform,
      message
    }) => {
      const runInstaller = installerEnding({
        code: 1,
        stderr: 'sudo: a terminal is required to read the password\n'
      })

      const error = await install({
        browser: 'edge',
        platform,
        runInstaller,
        systemEdge: noSystemEdge
      })

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as Error).message).toBe(message)
      expect(runInstaller).toHaveBeenCalledTimes(1)
    })

    it('keeps the privilege error when the broken tree cannot be removed, with the removal as its cause', async () => {
      const broken = plantTree(cacheRoot, 'edge')
      const destination = path.join(cacheRoot, 'edge')
      const removalError = busy(destination)

      const error = await install({
        browser: 'edge',
        removeTree: () => {
          throw removalError
        },
        runInstaller: installerEnding({
          code: 1,
          stderr: 'sudo: a password is required\n'
        }),
        systemEdge: noSystemEdge
      })

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as Error).message).toBe(
        PRIVILEGE_MESSAGE + notRemoved(destination)
      )

      expect((error as {cause?: unknown}).cause).toBe(removalError)
      expect(fs.existsSync(broken)).toBe(true)
    })

    // Playwright announces the switch on stdout before every attempt, and
    // only what su answered on stderr says the escalation itself failed.
    it('reads what su answered beside the root-switch line, on both streams together', async () => {
      plantTree(cacheRoot, 'edge')
      const output = {
        code: 1,
        stdout: 'Switching to root user to install dependencies...\n',
        stderr: 'su: Authentication failure\n'
      }

      const error = await install({
        browser: 'edge',
        runInstaller: installerEnding(output),
        systemEdge: noSystemEdge
      })

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as Error).message).toBe(PRIVILEGE_MESSAGE)
      expect(tree(cacheRoot)).toEqual([])

      expect(
        await install({
          browser: 'edge',
          runInstaller: installerEnding(output),
          systemEdge: {
            exists: never,
            lookup: () => LINUX_EDGE,
            registry: never
          }
        })
      ).toBe('installed')

      expect(warned).toEqual([
        '⏵⏵⏵ Warning: Skipping the Edge channel install, it needs elevated privileges.\n' +
          'Using the Edge binary already on this system instead.\n' +
          `PATH ${LINUX_EDGE}`
      ])
    })

    // The runner stopped an installer whose sudo prompt went unanswered. That
    // is a privilege refusal with its own words, not a slow download.
    it.each([
      {
        platform: 'linux',
        message:
          'Edge needs your password for sudo on Linux, and none was entered ' +
          'within 5 minutes, so the install was stopped. ' +
          'Run the install again and enter the password, ' +
          'or install Edge system-wide with your package manager ' +
          '(sudo apt install microsoft-edge-stable on Ubuntu and Debian, ' +
          'sudo dnf install microsoft-edge-stable on Fedora) ' +
          'and run Extension.js with --browser=edge. ' +
          'Use --browser=chromium when a privileged install is unavailable.'
      },
      {
        platform: 'darwin',
        message:
          'Edge needs an administrator password on macOS, and none was ' +
          'entered within 5 minutes, so the install was stopped. ' +
          'Run the install again and enter the password, ' +
          'then run Extension.js with --browser=edge. ' +
          'Use --browser=chromium when an administrator password is unavailable.'
      }
    ] as const)('refuses with the privilege code when the password prompt on $platform went unanswered', async ({
      platform,
      message
    }) => {
      plantTree(cacheRoot, 'edge')

      const error = await install({
        browser: 'edge',
        platform,
        runInstaller: installerEnding({
          code: null,
          signal: 'SIGTERM',
          stdout: 'Switching to root user to install dependencies...\n',
          promptTimedOut: true
        }),
        systemEdge: noSystemEdge
      })

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as BrowserInstallPrivilegeError).code).toBe(
        'BROWSER_INSTALL_PRIVILEGE'
      )

      expect((error as Error).message).toBe(message)
      expect(warned).toEqual([])
      expect(tree(cacheRoot)).toEqual([])
    })

    it('goes on with a system Edge when the password prompt went unanswered', async () => {
      expect(
        await install({
          browser: 'edge',
          runInstaller: installerEnding({
            code: null,
            signal: 'SIGTERM',
            promptTimedOut: true
          }),
          systemEdge: {
            exists: never,
            lookup: () => LINUX_EDGE,
            registry: never
          }
        })
      ).toBe('installed')

      expect(warned).toEqual([
        '⏵⏵⏵ Warning: Skipping the Edge channel install, it needs elevated privileges.\n' +
          'Using the Edge binary already on this system instead.\n' +
          `PATH ${LINUX_EDGE}`
      ])
    })

    it('removes the broken tree on a plain failure without asking for a system Edge', async () => {
      plantTree(cacheRoot, 'edge')

      const error = await install({
        browser: 'edge',
        runInstaller: installerEnding({code: 1, stderr: 'network down\n'})
      })

      expect(error).not.toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as Error).message).toBe(
        `Couldn't install Edge. The command ${EDGE_COMMAND} failed with exit ` +
          `code 1. Run it yourself to see the full error. ` +
          `Its output ended with: network down`
      )

      expect(tree(cacheRoot)).toEqual([])
    })

    it('keeps a managed Edge that still works on a plain failure', async () => {
      const managed = plantTree(cacheRoot, 'edge')
      const before = tree(cacheRoot)

      const error = await install({
        browser: 'edge',
        locateInstalledBinary: () => managed,
        runInstaller: installerEnding({code: 1, stderr: 'network down\n'})
      })

      expect((error as Error).message).toBe(
        `Couldn't install Edge. The command ${EDGE_COMMAND} failed with exit ` +
          `code 1. Run it yourself to see the full error. ` +
          `Its output ended with: network down`
      )

      expect(tree(cacheRoot)).toEqual([...before, `edge/${MARKER}`].sort())
    })

    it.each([
      {isRoot: false},
      {isRoot: true}
    ])('takes an Edge already on Linux as installed without a terminal, spawning nothing (root: $isRoot)', async ({
      isRoot
    }) => {
      const runInstaller = installerEnding({code: 0})
      const lookup = vi.fn(() => LINUX_EDGE)

      expect(
        await install({
          browser: 'edge',
          stdinIsTTY: false,
          isRoot,
          runInstaller,
          systemEdge: {exists: never, lookup, registry: never}
        })
      ).toBe('installed')

      expect(lookup.mock.calls).toEqual([['which', 'microsoft-edge']])
      expect(runInstaller).not.toHaveBeenCalled()
      expect(logged).toEqual([
        `⏵⏵⏵ Edge is already installed system-wide.\nPATH ${LINUX_EDGE}`
      ])

      expect(tree(cacheRoot)).toEqual([])
    })

    it('installs on Linux without a terminal when the process is root', async () => {
      const runInstaller = installerEnding({code: 0})
      const lookup = vi
        .fn<(tool: string, name: string) => string | null>()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValue(LINUX_EDGE)

      expect(
        await install({
          browser: 'edge',
          stdinIsTTY: false,
          isRoot: true,
          runInstaller,
          systemEdge: {exists: never, lookup, registry: never}
        })
      ).toBe('installed')

      expect(runInstaller.mock.calls[0].slice(0, 2)).toEqual([
        'pnpm',
        EDGE_COMMAND.split(' ').slice(1)
      ])

      expect(logged).toEqual([
        EDGE_INSTALLING,
        `⏵⏵⏵ Edge is installed system-wide.\nPATH ${LINUX_EDGE}`
      ])
    })

    it('refuses on Linux without a terminal when Edge is absent and the process is not root', async () => {
      const runInstaller = installerEnding({code: 0})
      const lookup = vi.fn(() => null)

      const error = await install({
        browser: 'edge',
        stdinIsTTY: false,
        isRoot: false,
        runInstaller,
        systemEdge: {exists: never, lookup, registry: never}
      })

      expect(lookup.mock.calls).toEqual([
        ['which', 'microsoft-edge'],
        ['which', 'microsoft-edge-stable'],
        ['which', 'msedge']
      ])

      expect(error).toBeInstanceOf(BrowserInstallPrivilegeError)
      expect((error as Error).name).toBe('BrowserInstallPrivilegeError')
      expect((error as BrowserInstallPrivilegeError).code).toBe(
        'BROWSER_INSTALL_PRIVILEGE'
      )

      expect((error as Error).message).toBe(PRIVILEGE_MESSAGE)
      expect(runInstaller).not.toHaveBeenCalled()
      expect(logged).toEqual([])
      expect(tree(cacheRoot)).toEqual([])
    })

    it.each([
      {platform: 'linux', stdinIsTTY: true},
      {platform: 'darwin', stdinIsTTY: false},
      {platform: 'win32', stdinIsTTY: false}
    ] as const)('runs the installer on $platform with a terminal: $stdinIsTTY', async ({
      platform,
      stdinIsTTY
    }) => {
      const runInstaller = installerEnding({code: 0})

      await install({
        browser: 'edge',
        platform,
        stdinIsTTY,
        runInstaller,
        systemEdge: noSystemEdge
      })

      expect(runInstaller).toHaveBeenCalledTimes(1)
    })

    it('never refuses a browser other than Edge for a missing terminal', async () => {
      const runInstaller = installerEnding({code: 0})

      await install({browser: 'chrome', stdinIsTTY: false, runInstaller})

      expect(runInstaller).toHaveBeenCalledTimes(1)
    })

    // Playwright installs Edge on Windows from an MSI that leaves nothing
    // under the destination and nothing `where msedge` sees.
    it.each([
      {
        found: 'under Program Files',
        hint: '',
        systemEdge: {
          exists: (file: string) => file === WINDOWS_EDGE,
          lookup: never,
          registry: never
        }
      },
      {
        found: 'through the App Paths registry key',
        hint: LAUNCHER_HINT,
        systemEdge: {
          exists: (file: string) => file === 'D:\\Edge\\msedge.exe',
          lookup: never,
          registry: (key: string) =>
            key.startsWith('HKLM\\') ? 'D:\\Edge\\msedge.exe' : null
        }
      }
    ])('succeeds on Windows after the installer exits 0 with Edge $found', async ({
      systemEdge,
      hint
    }) => {
      const runInstaller = installerEnding({code: 0})

      expect(
        await install({
          browser: 'edge',
          platform: 'win32',
          env: {
            EXT_BROWSERS_CACHE_DIR: cacheRoot,
            PATH: emptyBin,
            npm_config_user_agent: PNPM,
            'ProgramFiles(x86)': 'C:\\Program Files (x86)',
            ProgramFiles: 'C:\\Program Files'
          },
          runInstaller,
          systemEdge
        })
      ).toBe('installed')

      expect(runInstaller.mock.calls[0][0]).toBe('pnpm.cmd')
      expect(logged).toHaveLength(2)
      expect(logged[0]).toBe(EDGE_INSTALLING)
      expect(logged[1]).toBe(
        '⏵⏵⏵ Edge is installed system-wide.\n' +
          `PATH ${hint ? 'D:\\Edge\\msedge.exe' : WINDOWS_EDGE}${hint}`
      )
    })

    it('reports an incomplete install on Windows when no lookup finds Edge', async () => {
      const destination = path.join(cacheRoot, 'edge')
      const lookup = vi.fn(() => null)
      const registry = vi.fn(() => null)

      const error = await install({
        browser: 'edge',
        platform: 'win32',
        systemEdge: {exists: () => false, lookup, registry}
      })

      expect(registry).toHaveBeenCalledTimes(2)
      expect(lookup.mock.calls).toEqual([['where', 'msedge']])
      expect((error as Error).message).toBe(
        incomplete('Edge', destination, false)
      )

      expect(logged).toEqual([EDGE_INSTALLING])
    })
  })
})

describe('the two messages no install path printed before', () => {
  it('edgeInstallUsingSystemBinary names the binary it falls back to', () => {
    expect(
      stripVTControlCharacters(messages.edgeInstallUsingSystemBinary(MAC_EDGE))
    ).toBe(
      '⏵⏵⏵ Warning: Skipping the Edge channel install, it needs elevated privileges.\n' +
        'Using the Edge binary already on this system instead.\n' +
        `PATH ${MAC_EDGE}`
    )
  })

  it('uninstallRequiresTarget is one plain sentence pair', () => {
    expect(messages.uninstallRequiresTarget()).toBe(
      'A browser target is required. ' +
        'Pass --browser <name>, or --all to remove every browser.'
    )
  })
})
