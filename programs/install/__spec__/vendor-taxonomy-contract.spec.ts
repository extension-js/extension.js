import {createRequire} from 'node:module'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  computeSharedCacheRoot,
  managedBrowserCacheEnv
} from '../../extension/browsers/browsers-lib/output-binaries-resolver'
import {
  MANAGED_INSTALL_BINARIES,
  MANAGED_INSTALL_TARGETS
} from '../../extension/helpers/vendors'
import {ALL_BROWSER_TARGETS, BROWSER_ALIASES} from '../lib/browser-target'
import {
  resolveBrowserInstallDir,
  resolveBrowsersCacheRoot
} from '../lib/cache-root'
import {
  installPlan,
  LAUNCHER_EDGE_COMMAND,
  launcherEdgeFiles,
  locateSystemEdge
} from '../lib/runner'
import * as installModule from '../module'

// MANAGED_INSTALL_TARGETS (the CLI's accepted install names) and
// BROWSER_ALIASES (this package's resolver) are maintained by hand in two
// packages. A name present in one but not the other reproduces the split
// this contract exists to prevent: the CLI accepts a vendor the installer
// throws on, or the installer resolves a name the CLI never offers.
describe('install vendor taxonomy contract', () => {
  it('accepts exactly the same names in both packages', () => {
    expect(Object.keys(BROWSER_ALIASES).sort()).toEqual(
      [...MANAGED_INSTALL_TARGETS].sort()
    )
  })

  it('resolves every accepted name onto a managed binary', () => {
    for (const target of MANAGED_INSTALL_TARGETS) {
      expect(MANAGED_INSTALL_BINARIES).toContain(BROWSER_ALIASES[target])
    }
  })
})

// One table for both copies of the rule, on each platform's own path shapes,
// so a host never decides which platforms the parity is proven on.
describe('install cache root table on every platform', () => {
  const POSIX_CWD = '/work/project'
  const WIN_CWD = 'C:\\work\\project'
  const rows: Array<{
    platform: NodeJS.Platform
    name: string
    env: Record<string, string | undefined>
    expected: string
  }> = [
    {
      platform: 'linux',
      name: 'an absolute EXT_BROWSERS_CACHE_DIR',
      env: {EXT_BROWSERS_CACHE_DIR: '/abs/cache', HOME: '/home/me'},
      expected: '/abs/cache'
    },
    {
      platform: 'linux',
      name: 'a relative EXT_BROWSERS_CACHE_DIR',
      env: {EXT_BROWSERS_CACHE_DIR: ' rel/cache '},
      expected: '/work/project/rel/cache'
    },
    {
      platform: 'linux',
      name: 'XDG_CACHE_HOME beside HOME',
      env: {XDG_CACHE_HOME: '/xdg', HOME: '/home/me', LOCALAPPDATA: '/l'},
      expected: '/xdg/extension.js/browsers'
    },
    {
      platform: 'linux',
      name: 'HOME padded with spaces',
      env: {HOME: ' /home/me ', USERPROFILE: '/u'},
      expected: '/home/me/.cache/extension.js/browsers'
    },
    {
      platform: 'linux',
      name: 'nothing set',
      env: {EXT_BROWSERS_CACHE_DIR: '  ', XDG_CACHE_HOME: ''},
      expected: '/work/project/.cache/extension.js/browsers'
    },
    {
      platform: 'darwin',
      name: 'HOME, with XDG_CACHE_HOME ignored',
      env: {HOME: '/Users/me', XDG_CACHE_HOME: '/xdg'},
      expected: '/Users/me/Library/Caches/extension.js/browsers'
    },
    {
      platform: 'darwin',
      name: 'an absolute EXT_BROWSERS_CACHE_DIR',
      env: {
        EXT_BROWSERS_CACHE_DIR: '/Volumes/fast/browsers',
        HOME: '/Users/me'
      },
      expected: '/Volumes/fast/browsers'
    },
    {
      platform: 'darwin',
      name: 'nothing set',
      env: {},
      expected: '/work/project/.cache/extension.js/browsers'
    },
    {
      platform: 'win32',
      name: 'LOCALAPPDATA beside USERPROFILE and HOME',
      env: {
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\me',
        HOME: 'C:\\home'
      },
      expected: 'C:\\Users\\me\\AppData\\Local\\extension.js\\browsers'
    },
    {
      platform: 'win32',
      name: 'USERPROFILE alone',
      env: {USERPROFILE: 'C:\\Users\\me', HOME: 'C:\\home'},
      expected: 'C:\\Users\\me\\AppData\\Local\\extension.js\\browsers'
    },
    {
      platform: 'win32',
      name: 'an absolute EXT_BROWSERS_CACHE_DIR on another drive',
      env: {EXT_BROWSERS_CACHE_DIR: 'D:\\cache', LOCALAPPDATA: 'C:\\L'},
      expected: 'D:\\cache'
    },
    {
      platform: 'win32',
      name: 'a relative EXT_BROWSERS_CACHE_DIR with forward slashes',
      env: {EXT_BROWSERS_CACHE_DIR: 'rel/cache'},
      expected: 'C:\\work\\project\\rel\\cache'
    },
    {
      platform: 'win32',
      name: 'HOME alone, which Windows does not read',
      env: {HOME: 'C:\\home', XDG_CACHE_HOME: 'C:\\xdg'},
      expected: 'C:\\work\\project\\.cache\\extension.js\\browsers'
    }
  ]

  it.each(rows)('$platform: $name', ({platform, env, expected}) => {
    const cwd = platform === 'win32' ? WIN_CWD : POSIX_CWD

    expect(resolveBrowsersCacheRoot(env, platform, cwd)).toBe(expected)
    expect(computeSharedCacheRoot(env, platform, cwd)).toBe(expected)
  })

  it('covers all three platforms', () => {
    expect(new Set(rows.map((row) => row.platform))).toEqual(
      new Set(['linux', 'darwin', 'win32'])
    )
  })
})

// The installer picks the folder it downloads into and the launcher picks the
// folder it reads from, each with its own copy of the rules. The launcher's
// copy reads the process when called bare, the way the launcher calls it.
describe('install cache root contract', () => {
  const KEYS = [
    'EXT_BROWSERS_CACHE_DIR',
    'LOCALAPPDATA',
    'USERPROFILE',
    'XDG_CACHE_HOME',
    'HOME'
  ] as const
  const root = path.resolve('/parity')
  const cases: Array<{
    name: string
    env: Partial<Record<(typeof KEYS)[number], string>>
  }> = [
    {
      name: 'an absolute EXT_BROWSERS_CACHE_DIR',
      env: {EXT_BROWSERS_CACHE_DIR: path.join(root, 'explicit')}
    },
    {
      name: 'a relative EXT_BROWSERS_CACHE_DIR',
      env: {EXT_BROWSERS_CACHE_DIR: path.join('relative', 'browsers')}
    },
    {
      name: 'an EXT_BROWSERS_CACHE_DIR padded with spaces',
      env: {EXT_BROWSERS_CACHE_DIR: `  ${path.join(root, 'padded')}  `}
    },
    {
      name: 'a blank EXT_BROWSERS_CACHE_DIR beside every home',
      env: {
        EXT_BROWSERS_CACHE_DIR: '   ',
        LOCALAPPDATA: path.join(root, 'LocalAppData'),
        USERPROFILE: path.join(root, 'UserProfile'),
        XDG_CACHE_HOME: path.join(root, 'xdg'),
        HOME: path.join(root, 'home')
      }
    },
    {
      name: 'LOCALAPPDATA alone',
      env: {LOCALAPPDATA: path.join(root, 'LocalAppData')}
    },
    {
      name: 'USERPROFILE alone',
      env: {USERPROFILE: path.join(root, 'UserProfile')}
    },
    {
      name: 'XDG_CACHE_HOME beside HOME',
      env: {
        XDG_CACHE_HOME: path.join(root, 'xdg'),
        HOME: path.join(root, 'home')
      }
    },
    {name: 'HOME alone', env: {HOME: path.join(root, 'home')}},
    {name: 'a HOME padded with spaces', env: {HOME: ` ${root} `}},
    {name: 'a blank HOME', env: {HOME: '  '}},
    {name: 'none of them', env: {}}
  ]

  function stub(env: (typeof cases)[number]['env']) {
    for (const key of KEYS) vi.stubEnv(key, env[key])
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(cases)('agrees with the launcher under $name', ({env}) => {
    stub(env)

    const launcher = computeSharedCacheRoot()

    expect(resolveBrowsersCacheRoot()).toBe(launcher)
    expect(installModule.getManagedBrowsersCacheRoot()).toBe(launcher)
  })

  // Rows that all fell through to one answer would agree and compare nothing.
  it('compares more than one rule on this platform', () => {
    const answers = cases.map(({env}) => {
      stub(env)

      return computeSharedCacheRoot()
    })

    expect(new Set(answers).size).toBeGreaterThanOrEqual(5)
  })

  it.each([
    ...ALL_BROWSER_TARGETS
  ])('downloads %s into the folder the launcher reads it from', (browser) => {
    const destination = resolveBrowserInstallDir(browser, root)
    const launcher = managedBrowserCacheEnv(root, browser)
    const plan = installPlan(browser, destination, {
      env: {},
      platform: process.platform,
      cwd: root
    })

    if (browser === 'edge') {
      expect(plan.env.PLAYWRIGHT_BROWSERS_PATH).toBe(
        launcher.PLAYWRIGHT_BROWSERS_PATH
      )
    } else {
      // The installer makes its own subfolder, named after the browser.
      expect(plan.args.slice(-2)).toEqual(['--path', destination])
      expect(path.join(destination, browser)).toBe(launcher.PUPPETEER_CACHE_DIR)
    }
  })
})

// The install keeps a copy of the rules the launcher finds Edge by. The real
// edge-location is asked here for every place it checks, so the copy holds.
describe('install system Edge contract', () => {
  type LocateEdge = (deps: {
    fs: {existsSync: (file: string) => boolean}
    env: Record<string, string | undefined>
    platform: NodeJS.Platform
    userhome: (folder: string) => string
    which: {sync: (command: string) => string}
  }) => string | null

  const launcherRequire = createRequire(
    path.resolve(__dirname, '../../extension/package.json')
  )
  const edgeLocation = launcherRequire('edge-location') as
    | LocateEdge
    | {default: LocateEdge}
  const locateEdge =
    typeof edgeLocation === 'function' ? edgeLocation : edgeLocation.default

  const HOME = '/Users/dev'
  const WINDOWS = {
    LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)'
  }

  // The package joins Windows paths with the host's rules, so off Windows a
  // slash sits where the two halves meet.
  const sameSeparators = (file: string) => file.replace(/[\\/]+/g, '/')

  function launcherAsks(
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>
  ) {
    const files: string[] = []
    const commands: string[] = []

    const found = locateEdge({
      fs: {
        existsSync: (file) => {
          files.push(sameSeparators(file))

          return false
        }
      },
      env,
      platform,
      userhome: (folder) => `${HOME}/${folder}`,
      which: {
        sync: (command) => {
          commands.push(command)

          throw new Error('not found')
        }
      }
    })

    return {found, files, commands}
  }

  function installAsks(
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>
  ) {
    const files: string[] = []
    const commands: string[] = []

    locateSystemEdge({
      platform,
      env,
      exists: (file) => {
        files.push(sameSeparators(file))

        return false
      },
      lookup: (_tool, name) => {
        commands.push(name)

        return null
      },
      registry: () => null
    })

    return {files, commands}
  }

  it.each([
    {platform: 'darwin', env: {HOME, EDGE_BINARY: '/pinned/edge'}},
    {platform: 'win32', env: {...WINDOWS, EDGE_BINARY: 'D:\\pinned\\edge.exe'}},
    {platform: 'linux', env: {HOME, EDGE_BINARY: '/pinned/edge'}}
  ] as const)('asks first for what the launcher asks for on $platform, in its order', ({
    platform,
    env
  }) => {
    const launcher = launcherAsks(platform, env)
    const install = installAsks(platform, env)

    expect(launcher.found).toBe(null)
    expect(launcher.files.length + launcher.commands.length).toBeGreaterThan(1)
    expect(install.files.slice(0, launcher.files.length)).toEqual(
      launcher.files
    )

    expect(install.commands.slice(0, launcher.commands.length)).toEqual(
      launcher.commands
    )
  })

  it('names the launcher places themselves, per platform', () => {
    expect(launcherAsks('darwin', {HOME}).files).toEqual(
      launcherEdgeFiles('darwin', {HOME})
    )

    expect(launcherAsks('win32', WINDOWS).files).toEqual(
      launcherEdgeFiles('win32', WINDOWS).map(sameSeparators)
    )

    expect(launcherAsks('linux', {HOME})).toEqual({
      found: null,
      files: [],
      commands: [LAUNCHER_EDGE_COMMAND]
    })

    expect(launcherEdgeFiles('linux', {HOME})).toEqual([])
  })

  // Every place the install marks as one the launcher finds is handed back to
  // the real package as the only file on disk, which then has to find it.
  it.each([
    {platform: 'darwin', env: {HOME}},
    {platform: 'win32', env: WINDOWS}
  ] as const)('marks only places the launcher really finds on $platform', ({
    platform,
    env
  }) => {
    const places = launcherEdgeFiles(platform, env)

    expect(places.length).toBeGreaterThanOrEqual(2)

    for (const place of places) {
      const only = (file: string) =>
        sameSeparators(file) === sameSeparators(place)

      expect(
        locateSystemEdge({
          platform,
          env,
          exists: only,
          lookup: () => null,
          registry: () => null
        })
      ).toEqual({path: place, launcherFinds: true})

      const found = locateEdge({
        fs: {existsSync: only},
        env,
        platform,
        userhome: (folder) => `${HOME}/${folder}`,
        which: {
          sync: () => {
            throw new Error('not found')
          }
        }
      })

      expect(sameSeparators(String(found))).toBe(sameSeparators(place))
    }
  })
})

// The CLI type-checks against its own hand-written declaration of this
// package. This assignment compiles only while the real exports satisfy it.
describe('install declaration contract', () => {
  const declared: typeof import('extension-install') = installModule
  const names: Array<keyof typeof import('extension-install')> = [
    'BrowserCacheRootError',
    'BrowserInstallBusyError',
    'BrowserInstallerNotFoundError',
    'BrowserInstallFailedError',
    'BrowserInstallForeignFolderError',
    'BrowserInstallTimeoutError',
    'BrowserInstallPrivilegeError',
    'BrowserNotInstallableError',
    'BrowserUninstallError',
    'extensionInstall',
    'extensionUninstall',
    'getManagedBrowserInstallDir',
    'getManagedBrowsersCacheRoot',
    'isBrowserCacheRootError',
    'isBrowserInstallBusyError',
    'isBrowserInstallerNotFoundError',
    'isBrowserInstallFailedError',
    'isBrowserInstallForeignFolderError',
    'isBrowserInstallPrivilegeError',
    'isBrowserInstallTimeoutError',
    'isBrowserNotInstallableError'
  ]

  it.each(names)('exports %s, which the CLI declares', (name) => {
    expect(typeof declared[name]).toBe('function')
  })
})
