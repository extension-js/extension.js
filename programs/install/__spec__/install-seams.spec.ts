import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MANAGED_INSTALL_BINARIES} from '../../extension/helpers/vendors'
import {
  ALL_BROWSER_TARGETS,
  BROWSER_ALIASES,
  type InstallBrowserTarget
} from '../lib/browser-target'
import {resolveBrowsersCacheRoot} from '../lib/cache-root'
import {
  PLAYWRIGHT_VERSION,
  PUPPETEER_BROWSERS_VERSION
} from '../lib/installer-versions'
import {
  browserInstallArgs,
  browserInstallCommand,
  browserInstallCwd,
  browserInstallEnv,
  buildExecEnv,
  type CommandResult,
  detectSystemEdgeBinary,
  edgeInstallNeedsInteractivePrivilegedSession,
  installPlan,
  isEdgePrivilegeEscalationFailure,
  locateSystemEdge,
  lookupOnPath,
  packageManagerFromExecPath,
  prepareInstall,
  queryRegistryDefault
} from '../lib/runner'
import {
  extensionInstall,
  extensionUninstall,
  getManagedBrowsersCacheRoot
} from '../module'

// Every folder a case names is made under here, so nothing these specs read
// or write can be a real project, a real cache or a real browser.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-seams-'))
const project = path.join(scratch, 'project')
fs.mkdirSync(project)

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

const HOME = path.join(scratch, 'home')
const XDG = path.join(scratch, 'xdg')
const LOCALAPPDATA = path.join(scratch, 'LocalAppData')
const USERPROFILE = path.join(scratch, 'UserProfile')

describe('resolveBrowsersCacheRoot from an explicit env, platform and cwd', () => {
  // Each row names paths shaped for the platform it injects, so a Windows
  // host and a POSIX host compute the same literal answer. Nothing is written.
  const POSIX_PROJECT = '/dev/project'
  const POSIX_HOME = '/home/dev'
  const POSIX_XDG = '/xdg'
  const everything = {
    HOME: POSIX_HOME,
    XDG_CACHE_HOME: POSIX_XDG,
    LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\dev'
  }
  const cwdFallback = `${POSIX_PROJECT}/.cache/extension.js/browsers`
  const WIN_PROJECT = 'C:\\dev\\project'
  const WIN_LOCALAPPDATA = 'C:\\Users\\dev\\AppData\\Local'
  const WIN_USERPROFILE = 'C:\\Users\\dev'
  const winEverything = {
    HOME,
    XDG_CACHE_HOME: XDG,
    LOCALAPPDATA: WIN_LOCALAPPDATA,
    USERPROFILE: WIN_USERPROFILE
  }

  const cases: Array<{
    name: string
    platform: NodeJS.Platform
    env: Record<string, string | undefined>
    expected: string
    cwd?: string
  }> = [
    {
      name: 'win32 uses LOCALAPPDATA first',
      platform: 'win32',
      env: winEverything,
      cwd: WIN_PROJECT,
      expected: `${WIN_LOCALAPPDATA}\\extension.js\\browsers`
    },
    {
      name: 'win32 falls back to USERPROFILE',
      platform: 'win32',
      env: {HOME, XDG_CACHE_HOME: XDG, USERPROFILE: WIN_USERPROFILE},
      cwd: WIN_PROJECT,
      expected: `${WIN_USERPROFILE}\\AppData\\Local\\extension.js\\browsers`
    },
    {
      name: 'win32 with neither falls back to the working directory',
      platform: 'win32',
      env: {HOME, XDG_CACHE_HOME: XDG},
      cwd: WIN_PROJECT,
      expected: `${WIN_PROJECT}\\.cache\\extension.js\\browsers`
    },
    {
      name: 'darwin uses HOME and ignores the XDG and Windows variables',
      platform: 'darwin',
      env: everything,
      expected: `${POSIX_HOME}/Library/Caches/extension.js/browsers`
    },
    {
      name: 'darwin without HOME falls back to the working directory',
      platform: 'darwin',
      env: {XDG_CACHE_HOME: POSIX_XDG, LOCALAPPDATA, USERPROFILE},
      expected: cwdFallback
    },
    {
      name: 'linux uses XDG_CACHE_HOME first',
      platform: 'linux',
      env: everything,
      expected: `${POSIX_XDG}/extension.js/browsers`
    },
    {
      name: 'linux falls back to HOME',
      platform: 'linux',
      env: {HOME: POSIX_HOME, LOCALAPPDATA, USERPROFILE},
      expected: `${POSIX_HOME}/.cache/extension.js/browsers`
    },
    {
      name: 'linux with neither falls back to the working directory',
      platform: 'linux',
      env: {LOCALAPPDATA, USERPROFILE},
      expected: cwdFallback
    },
    {
      name: 'a platform with no branch of its own resolves like linux',
      platform: 'freebsd',
      env: everything,
      expected: `${POSIX_XDG}/extension.js/browsers`
    },
    {
      name: 'a blank variable counts as unset',
      platform: 'linux',
      env: {XDG_CACHE_HOME: '   ', HOME: '', EXT_BROWSERS_CACHE_DIR: '  '},
      expected: cwdFallback
    },
    {
      name: 'a variable is trimmed before it is used',
      platform: 'linux',
      env: {XDG_CACHE_HOME: `  ${POSIX_XDG}  `},
      expected: `${POSIX_XDG}/extension.js/browsers`
    }
  ]

  it.each(cases)('$name', ({platform, env, expected, cwd = POSIX_PROJECT}) => {
    expect(resolveBrowsersCacheRoot(env, platform, cwd)).toBe(expected)
  })

  it.each([
    ['win32', 'D:\\override', WIN_PROJECT, winEverything],
    ['darwin', '/override', POSIX_PROJECT, everything],
    ['linux', '/override', POSIX_PROJECT, everything]
  ] as const)('EXT_BROWSERS_CACHE_DIR outranks every default on %s', (platform, override, cwd, env) => {
    expect(
      resolveBrowsersCacheRoot(
        {...env, EXT_BROWSERS_CACHE_DIR: override},
        platform,
        cwd
      )
    ).toBe(override)
  })

  it('resolves a relative EXT_BROWSERS_CACHE_DIR against the given cwd', () => {
    expect(
      resolveBrowsersCacheRoot(
        {EXT_BROWSERS_CACHE_DIR: 'rel/cache'},
        'linux',
        POSIX_PROJECT
      )
    ).toBe(`${POSIX_PROJECT}/rel/cache`)
  })

  it('reads the process for whatever the caller leaves out', () => {
    expect(resolveBrowsersCacheRoot()).toBe(
      resolveBrowsersCacheRoot(process.env, process.platform, process.cwd())
    )

    expect(resolveBrowsersCacheRoot({}, 'linux')).toBe(
      path.join(process.cwd(), '.cache', 'extension.js', 'browsers')
    )
  })
})

const MANAGERS = [
  {
    manager: 'npm',
    env: {npm_config_user_agent: 'npm/12.0.1 node/v24.0.0 darwin arm64'},
    runner: 'npx',
    prefix: ['-y'],
    inProject: false
  },
  {
    manager: 'pnpm',
    env: {npm_config_user_agent: 'pnpm/10.28.0 npm/? node/v23.8.0'},
    runner: 'pnpm',
    prefix: ['dlx'],
    inProject: true
  },
  {
    manager: 'yarn berry',
    env: {npm_config_user_agent: 'yarn/4.17.1 npm/? node/v24.0.0 darwin arm64'},
    runner: 'yarn',
    prefix: ['dlx'],
    inProject: true
  },
  {
    manager: 'bun',
    env: {npm_config_user_agent: 'bun/1.3.0 npm/? node/v24.3.0 darwin arm64'},
    runner: 'bunx',
    prefix: [],
    inProject: true
  },
  {
    manager: 'yarn classic, which has no package runner',
    env: {npm_config_user_agent: 'yarn/1.22.22 npm/? node/v24.0.0'},
    runner: 'npx',
    prefix: ['-y'],
    inProject: false
  },
  {
    manager: 'no manager named at all',
    env: {},
    runner: 'npx',
    prefix: ['-y'],
    inProject: false
  },
  {
    manager: 'pnpm named only by npm_execpath',
    env: {npm_execpath: '/opt/pnpm/bin/pnpm.cjs'},
    runner: 'pnpm',
    prefix: ['dlx'],
    inProject: true
  },
  {
    manager: 'bun named only by NPM_EXEC_PATH',
    env: {NPM_EXEC_PATH: '/opt/bun/bin/bun'},
    runner: 'bunx',
    prefix: [],
    inProject: true
  },
  {
    manager: 'yarn named only by npm_execpath, so its version is unknown',
    env: {npm_execpath: '/opt/yarn/bin/yarn.js'},
    runner: 'npx',
    prefix: ['-y'],
    inProject: false
  }
] as const

// The cache variables are shaped for the platform each row injects, so every
// host computes the same literal folder. The plan only names it.
const PLATFORMS = [
  {
    platform: 'linux',
    suffix: '',
    cacheEnv: {HOME: '/home/dev'},
    cacheRoot: '/home/dev/.cache/extension.js/browsers'
  },
  {
    platform: 'darwin',
    suffix: '',
    cacheEnv: {HOME: '/Users/dev'},
    cacheRoot: '/Users/dev/Library/Caches/extension.js/browsers'
  },
  {
    platform: 'win32',
    suffix: '.cmd',
    cacheEnv: {LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local'},
    cacheRoot: 'C:\\Users\\dev\\AppData\\Local\\extension.js\\browsers'
  }
] as const

const TARGETS: Array<{
  target: InstallBrowserTarget
  tail: (destination: string) => string[]
  extraEnv: (destination: string) => Record<string, string>
}> = [
  {
    target: 'chromium',
    tail: (destination) => [
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'chromium',
      '--path',
      destination
    ],
    extraEnv: () => ({})
  },
  {
    target: 'chrome',
    tail: (destination) => [
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'chrome@stable',
      '--path',
      destination
    ],
    extraEnv: () => ({})
  },
  {
    target: 'firefox',
    tail: (destination) => [
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'firefox@stable',
      '--path',
      destination
    ],
    extraEnv: () => ({})
  },
  {
    target: 'edge',
    tail: () => [`playwright@${PLAYWRIGHT_VERSION}`, 'install', 'msedge'],
    extraEnv: (destination) => ({PLAYWRIGHT_BROWSERS_PATH: destination})
  }
]

describe('installPlan from an explicit env, platform and cwd', () => {
  const matrix = MANAGERS.flatMap((manager) =>
    PLATFORMS.flatMap((platform) =>
      TARGETS.map((target) => ({...manager, ...platform, ...target}))
    )
  )

  it('covers every manager on every platform for every target', () => {
    expect(matrix).toHaveLength(MANAGERS.length * PLATFORMS.length * 4)
    expect(TARGETS.map((row) => row.target).sort()).toEqual(
      [...ALL_BROWSER_TARGETS].sort()
    )
  })

  it.each(matrix)('$manager on $platform installing $target', (row) => {
    const destination = path.join(scratch, 'browsers', row.target)
    const env: Record<string, string | undefined> = {
      ...row.env,
      ...row.cacheEnv,
      PATH: path.join(scratch, 'bin')
    }
    const given = {...env}

    const plan = installPlan(row.target, destination, {
      env,
      platform: row.platform,
      cwd: project
    })

    expect(plan).toEqual({
      command: `${row.runner}${row.suffix}`,
      args: [...row.prefix, ...row.tail(destination)],
      env: {...given, ...row.extraEnv(destination)},
      cwd: row.inProject ? project : row.cacheRoot
    })

    expect(plan.env).not.toBe(env)
    expect(env).toEqual(given)
  })

  it('hands the runner the Corepack registry the project .npmrc pins', () => {
    const pinned = path.join(scratch, 'pinned-project')
    fs.mkdirSync(pinned)
    fs.writeFileSync(
      path.join(pinned, '.npmrc'),
      'registry=http://127.0.0.1:4876/\n'
    )

    const plan = installPlan('chrome', path.join(scratch, 'browsers'), {
      env: {HOME, corepack_npm_registry: ''},
      platform: 'linux',
      cwd: pinned
    })

    expect(plan.env).toEqual({
      HOME,
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4876'
    })
  })

  it('keeps a Corepack registry the environment already carries, and adds the Edge path beside either', () => {
    const pinned = path.join(scratch, 'pinned-edge-project')
    const destination = path.join(scratch, 'browsers', 'edge')
    fs.mkdirSync(pinned)
    fs.writeFileSync(
      path.join(pinned, '.npmrc'),
      'registry=http://127.0.0.1:4876/\n'
    )

    const plan = (env: Record<string, string | undefined>) =>
      installPlan('edge', destination, {env, platform: 'linux', cwd: pinned})

    expect(
      plan({HOME, COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4877'}).env
    ).toEqual({
      HOME,
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4877',
      PLAYWRIGHT_BROWSERS_PATH: destination
    })

    expect(plan({HOME}).env).toEqual({
      HOME,
      COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4876',
      PLAYWRIGHT_BROWSERS_PATH: destination
    })
  })

  it('pins each installer to an exact version, never a tag or a range', () => {
    const exact = /^\d+\.\d+\.\d+$/

    expect(PUPPETEER_BROWSERS_VERSION).toMatch(exact)
    expect(PLAYWRIGHT_VERSION).toMatch(exact)
  })

  it('writes nothing, and prepareInstall makes only the folder npx starts in', () => {
    const cacheRoot = path.join(scratch, 'not-made-yet')
    const destination = path.join(cacheRoot, 'chrome')
    const underNpx = {
      env: {EXT_BROWSERS_CACHE_DIR: cacheRoot},
      platform: 'linux' as const,
      cwd: project
    }
    const underPnpm = {
      ...underNpx,
      env: {...underNpx.env, npm_config_user_agent: 'pnpm/10.28.0 npm/?'}
    }

    const plan = installPlan('chrome', destination, underNpx)
    expect(plan.cwd).toBe(cacheRoot)
    expect(fs.existsSync(cacheRoot)).toBe(false)

    expect(prepareInstall('chrome', destination, underPnpm).cwd).toBe(project)
    expect(fs.existsSync(cacheRoot)).toBe(false)

    expect(prepareInstall('chrome', destination, underNpx)).toEqual(plan)
    expect(fs.readdirSync(cacheRoot)).toEqual([])
  })
})

describe('the browserInstall wrappers against installPlan', () => {
  const cacheRoot = path.join(scratch, 'wrapper-cache')

  // browserInstallCwd makes the cache root under npx, so it is pointed at
  // scratch. One named variable, restored after each case.
  beforeEach(() => {
    vi.stubEnv('EXT_BROWSERS_CACHE_DIR', cacheRoot)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const inputs = (['chromium', 'chrome', 'firefox', 'edge'] as const).flatMap(
    (target) =>
      [
        path.join(scratch, 'browsers', target),
        'C:\\Users\\me & rm -rf x\\browsers'
      ].map((destination) => ({target, destination}))
  )

  it.each(inputs)('$target into $destination', ({target, destination}) => {
    const plan = installPlan(target, destination, {
      env: process.env,
      platform: process.platform,
      cwd: process.cwd()
    })

    expect({
      command: browserInstallCommand(target),
      args: browserInstallArgs(target, destination),
      env: browserInstallEnv(target, destination),
      cwd: browserInstallCwd()
    }).toEqual(plan)

    expect(installPlan(target, destination)).toEqual(plan)
  })
})

describe('the list that all expands to', () => {
  const cacheRoot = path.join(scratch, 'uninstall-cache')

  beforeEach(() => {
    vi.stubEnv('EXT_BROWSERS_CACHE_DIR', cacheRoot)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('names the four managed browsers in the order they are reported', () => {
    expect(ALL_BROWSER_TARGETS).toEqual([
      'chrome',
      'chromium',
      'edge',
      'firefox'
    ])
  })

  it('is every browser an accepted install name resolves onto', () => {
    expect([...new Set(Object.values(BROWSER_ALIASES))]).toEqual([
      ...ALL_BROWSER_TARGETS
    ])
  })

  it('equals what the CLI iterates for install all', () => {
    expect([...MANAGED_INSTALL_BINARIES]).toEqual([...ALL_BROWSER_TARGETS])
  })

  it('is what uninstall all walks, one cache folder each', async () => {
    // The guard that keeps this case off the real cache.
    expect(getManagedBrowsersCacheRoot()).toBe(cacheRoot)
    fs.mkdirSync(path.join(cacheRoot, 'edge', 'mac_arm-152.0.9999.1'), {
      recursive: true
    })

    const results = await extensionUninstall({all: true})

    expect(
      results.map(({browser, outcome, path: folder}) => [
        browser,
        outcome,
        folder
      ])
    ).toEqual([
      ['chrome', 'absent', path.join(cacheRoot, 'chrome')],
      ['chromium', 'absent', path.join(cacheRoot, 'chromium')],
      ['edge', 'removed', path.join(cacheRoot, 'edge')],
      ['firefox', 'absent', path.join(cacheRoot, 'firefox')]
    ])
  })
})

describe('extensionInstall with an injected runInstaller', () => {
  const cacheRoot = path.join(scratch, 'install-cache')
  const destination = path.join(cacheRoot, 'chrome')
  const binary = path.join(destination, 'chrome-stub')

  // PATH points at an empty folder so that a case which lost the injected
  // runner could not find npx or pnpm, and so could not download.
  beforeEach(() => {
    fs.mkdirSync(path.join(scratch, 'empty-bin'), {recursive: true})
    vi.stubEnv('PATH', path.join(scratch, 'empty-bin'))
    vi.stubEnv('EXT_BROWSERS_CACHE_DIR', cacheRoot)
    vi.stubEnv('npm_config_user_agent', 'pnpm/10.28.0 npm/? node/v23.8.0')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function installerEnding(result: Partial<CommandResult>) {
    return vi.fn(async () => ({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      ...result
    }))
  }

  it('runs the plan through the injected runner, once', async () => {
    const runInstaller = installerEnding({code: 0})
    const plan = installPlan('chrome', destination)

    await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => binary,
      runInstaller
    })

    expect(plan.command).toBe(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    )

    expect(plan.args).toEqual([
      'dlx',
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'chrome@stable',
      '--path',
      destination
    ])

    expect(runInstaller.mock.calls).toEqual([
      [
        plan.command,
        plan.args,
        {cwd: process.cwd(), env: plan.env, timeoutMs: 30 * 60_000}
      ]
    ])
  })

  it('turns the exit the injected runner reports into the failure', async () => {
    const runInstaller = installerEnding({code: 7, stderr: 'boom\n'})

    const error: unknown = await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => null,
      runInstaller
    }).catch((thrown: unknown) => thrown)

    expect((error as Error).message).toBe(
      `Couldn't install Chrome. The command ${
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
      } dlx @puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION} install ` +
        `chrome@stable --path ${destination} failed with exit code 7. ` +
        `Run it yourself to see the full error. Its output ended with: boom`
    )

    expect(runInstaller).toHaveBeenCalledTimes(1)
  })
})

describe('detectSystemEdgeBinary with injected lookups', () => {
  const MAC_EDGE =
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'

  function never(): never {
    throw new Error('this lookup does not belong to the platform')
  }

  const USER_MAC_EDGE = `/Users/dev/Applications/${MAC_EDGE.slice('/Applications/'.length)}`

  it.each([
    {found: MAC_EDGE, asked: [MAC_EDGE]},
    {found: USER_MAC_EDGE, asked: [MAC_EDGE, USER_MAC_EDGE]},
    {found: null, asked: [MAC_EDGE, USER_MAC_EDGE]}
  ])('darwin checks /Applications, then the Applications folder of the home (found: $found)', ({
    found,
    asked
  }) => {
    const exists = vi.fn((file: string) => file === found)

    expect(
      locateSystemEdge({
        platform: 'darwin',
        env: {HOME: '/Users/dev'},
        exists,
        lookup: never,
        registry: never
      })
    ).toEqual(found ? {path: found, launcherFinds: true} : null)

    expect(exists.mock.calls).toEqual(asked.map((file) => [file]))
  })

  it.each([
    'darwin',
    'win32',
    'linux'
  ] as const)('takes an existing EDGE_BINARY first on %s, as the launcher does', (platform) => {
    const pinned = '/opt/pinned/edge'
    const exists = vi.fn((file: string) => file === pinned)

    expect(
      locateSystemEdge({
        platform,
        env: {EDGE_BINARY: pinned, HOME: '/Users/dev'},
        exists,
        lookup: never,
        registry: never
      })
    ).toEqual({path: pinned, launcherFinds: true})

    expect(exists.mock.calls).toEqual([[pinned]])
  })

  it('passes over an EDGE_BINARY that is not on disk', () => {
    const lookup = vi.fn(() => '/usr/bin/microsoft-edge')

    expect(
      locateSystemEdge({
        platform: 'linux',
        env: {EDGE_BINARY: '/gone/edge'},
        exists: () => false,
        lookup,
        registry: never
      })
    ).toEqual({path: '/usr/bin/microsoft-edge', launcherFinds: true})
  })

  const X86 = 'C:\\Program Files (x86)'
  const X64 = 'C:\\Program Files'
  const LOCAL = 'C:\\Users\\dev\\AppData\\Local'
  const TAIL = '\\Microsoft\\Edge\\Application\\msedge.exe'
  const APP_PATHS =
    'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'
  const REGISTERED = 'D:\\Apps\\Edge\\msedge.exe'

  function onWindows(found: {
    files?: string[]
    registered?: Record<string, string>
    onPath?: string | null
    env?: Record<string, string | undefined>
  }) {
    const exists = vi.fn((file: string) => (found.files || []).includes(file))
    const registry = vi.fn((key: string) => found.registered?.[key] ?? null)
    const lookup = vi.fn(() => found.onPath ?? null)

    return {
      exists,
      registry,
      lookup,
      answer: detectSystemEdgeBinary({
        platform: 'win32',
        env: found.env || {'ProgramFiles(x86)': X86, ProgramFiles: X64},
        exists,
        registry,
        lookup
      })
    }
  }

  // The launcher's order: the per-user install, then 64-bit, then 32-bit.
  it('win32 takes the per-user install first and asks nothing else', () => {
    const {answer, exists, registry, lookup} = onWindows({
      files: [LOCAL + TAIL, X86 + TAIL, X64 + TAIL],
      registered: {[`HKLM\\${APP_PATHS}`]: REGISTERED},
      onPath: 'C:\\elsewhere\\msedge.exe',
      env: {LOCALAPPDATA: LOCAL, 'ProgramFiles(x86)': X86, ProgramFiles: X64}
    })

    expect(answer).toBe(LOCAL + TAIL)
    expect(exists.mock.calls).toEqual([[LOCAL + TAIL]])
    expect(registry).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('win32 takes the 64-bit Program Files install before the 32-bit one', () => {
    const {answer, exists, registry} = onWindows({
      files: [X86 + TAIL, X64 + TAIL]
    })

    expect(answer).toBe(X64 + TAIL)
    expect(exists.mock.calls).toEqual([[X64 + TAIL]])
    expect(registry).not.toHaveBeenCalled()
  })

  it('win32 takes the 32-bit Program Files install third', () => {
    const {answer, exists, registry} = onWindows({files: [X86 + TAIL]})

    expect(answer).toBe(X86 + TAIL)
    expect(exists.mock.calls).toEqual([[X64 + TAIL], [X86 + TAIL]])
    expect(registry).not.toHaveBeenCalled()
  })

  it.each<{
    name: string
    found: {
      files?: string[]
      registered?: Record<string, string>
      onPath?: string
    }
    expected: {path: string; launcherFinds: boolean}
  }>([
    {
      name: 'a standard folder',
      found: {files: [X64 + TAIL]},
      expected: {path: X64 + TAIL, launcherFinds: true}
    },
    {
      name: 'the App Paths key alone',
      found: {
        files: [REGISTERED],
        registered: {[`HKCU\\${APP_PATHS}`]: REGISTERED}
      },
      expected: {path: REGISTERED, launcherFinds: false}
    },
    {
      name: 'PATH alone',
      found: {onPath: 'C:\\elsewhere\\msedge.exe'},
      expected: {path: 'C:\\elsewhere\\msedge.exe', launcherFinds: false}
    }
  ])('win32 says whether the launcher finds an Edge found through $name', ({
    found,
    expected
  }) => {
    const exists = (file: string) => (found.files || []).includes(file)

    expect(
      locateSystemEdge({
        platform: 'win32',
        env: {'ProgramFiles(x86)': X86, ProgramFiles: X64},
        exists,
        registry: (key) => found.registered?.[key] ?? null,
        lookup: () => found.onPath ?? null
      })
    ).toEqual(expected)
  })

  it.each([
    'HKLM',
    'HKCU'
  ])('win32 takes the App Paths key under %s when no standard folder holds Edge', (hive) => {
    const {answer, registry, lookup} = onWindows({
      files: [REGISTERED],
      registered: {[`${hive}\\${APP_PATHS}`]: REGISTERED},
      onPath: 'C:\\elsewhere\\msedge.exe'
    })

    expect(answer).toBe(REGISTERED)
    expect(registry.mock.calls).toEqual(
      hive === 'HKLM'
        ? [[`HKLM\\${APP_PATHS}`]]
        : [[`HKLM\\${APP_PATHS}`], [`HKCU\\${APP_PATHS}`]]
    )

    expect(lookup).not.toHaveBeenCalled()
  })

  it('win32 passes over a registered path that is no longer on disk', () => {
    const {answer, lookup} = onWindows({
      registered: {[`HKLM\\${APP_PATHS}`]: REGISTERED},
      onPath: 'C:\\elsewhere\\msedge.exe'
    })

    expect(answer).toBe('C:\\elsewhere\\msedge.exe')
    expect(lookup.mock.calls).toEqual([['where', 'msedge']])
  })

  it('win32 asks where for msedge last, and returns null when it misses too', () => {
    const {answer, exists, registry, lookup} = onWindows({})

    expect(answer).toBe(null)
    expect(exists.mock.calls).toEqual([[X64 + TAIL], [X86 + TAIL]])
    expect(registry.mock.calls).toEqual([
      [`HKLM\\${APP_PATHS}`],
      [`HKCU\\${APP_PATHS}`]
    ])

    expect(lookup.mock.calls).toEqual([['where', 'msedge']])
  })

  it.each([
    {
      name: 'the names in the case Windows spells them',
      env: {'ProgramFiles(x86)': X86, ProgramFiles: X64}
    },
    {
      name: 'the names in upper case',
      env: {'PROGRAMFILES(X86)': X86, PROGRAMFILES: X64}
    }
  ])('win32 reads the install roots from the given env under $name', ({
    env
  }) => {
    expect(onWindows({files: [X64 + TAIL], env}).answer).toBe(X64 + TAIL)
  })

  it('win32 skips an install root the env does not name', () => {
    const {answer, exists} = onWindows({
      files: [X86 + TAIL],
      env: {'ProgramFiles(x86)': '  ', ProgramFiles: X64}
    })

    expect(answer).toBe(null)
    expect(exists.mock.calls).toEqual([[X64 + TAIL]])
  })

  it('linux asks first for the one name the launcher asks for', () => {
    const lookup = vi.fn((_tool: string, name: string) =>
      name === 'microsoft-edge' ? '/usr/bin/microsoft-edge' : null
    )

    expect(
      locateSystemEdge({platform: 'linux', env: {}, exists: never, lookup})
    ).toEqual({path: '/usr/bin/microsoft-edge', launcherFinds: true})

    expect(lookup.mock.calls).toEqual([['which', 'microsoft-edge']])
  })

  it.each([
    {name: 'microsoft-edge-stable', asked: 2},
    {name: 'msedge', asked: 3}
  ])('linux finds $name after it, and says the launcher does not', ({
    name,
    asked
  }) => {
    const lookup = vi.fn((_tool: string, wanted: string) =>
      wanted === name ? `/opt/edge/${name}` : null
    )

    expect(
      locateSystemEdge({platform: 'linux', env: {}, exists: never, lookup})
    ).toEqual({path: `/opt/edge/${name}`, launcherFinds: false})

    expect(lookup).toHaveBeenCalledTimes(asked)
  })

  it('linux returns null once all three names miss', () => {
    const lookup = vi.fn(() => null)

    expect(
      detectSystemEdgeBinary({platform: 'linux', exists: never, lookup})
    ).toBe(null)

    expect(lookup.mock.calls).toEqual([
      ['which', 'microsoft-edge'],
      ['which', 'microsoft-edge-stable'],
      ['which', 'msedge']
    ])
  })
})

describe('queryRegistryDefault, one reg query answer', () => {
  const KEY =
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'
  // The layout reg.exe prints for `reg query <key> /ve`, written out by hand
  // from its documented format. It was not captured from a Windows run.
  const FOUND =
    '\r\n' +
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe\r\n' +
    '    (Default)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\r\n' +
    '\r\n'

  function answering(status: number | null, stdout: string) {
    return vi.fn((_tool: string, _args: string[]) => ({status, stdout}))
  }

  it('asks reg for the default value of the key and returns the path it prints', () => {
    const run = answering(0, FOUND)

    expect(queryRegistryDefault(KEY, run)).toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    )

    expect(run.mock.calls).toEqual([['reg', ['query', KEY, '/ve']]])
  })

  it.each([
    {
      name: 'a value written in quotes',
      stdout: '    (Default)    REG_SZ    "D:\\My Apps\\msedge.exe"\r\n',
      expected: 'D:\\My Apps\\msedge.exe'
    },
    {
      name: 'a value name in another language, on Unix line ends',
      stdout: '\nHKEY_CURRENT_USER\\x\n    (Standard)    REG_SZ    D:\\e.exe\n',
      expected: 'D:\\e.exe'
    }
  ])('returns $name', ({stdout, expected}) => {
    expect(queryRegistryDefault(KEY, answering(0, stdout))).toBe(expected)
  })

  it.each([
    {
      // reg.exe exits 1 and writes its complaint to stderr, so stdout is empty.
      name: 'a key that is not there',
      status: 1,
      stdout: ''
    },
    {name: 'a reg that could not start', status: null, stdout: ''},
    {
      name: 'a key with a default of another type',
      status: 0,
      stdout: '    (Default)    REG_DWORD    0x1\r\n'
    },
    {name: 'a zero exit that printed nothing', status: 0, stdout: ''}
  ])('returns null on $name', ({status, stdout}) => {
    expect(queryRegistryDefault(KEY, answering(status, stdout))).toBe(null)
  })
})

describe('the package manager read from npm_execpath when no user agent names one', () => {
  function runner(env: Record<string, string | undefined>): string {
    return installPlan('chrome', path.join(scratch, 'browsers'), {
      env: {HOME, ...env},
      platform: 'linux',
      cwd: project
    }).command
  }

  it.each([
    {
      name: 'the user agent outranks npm_execpath',
      env: {
        npm_config_user_agent: 'npm/12.0.1 node/v24.0.0 linux x64',
        npm_execpath: '/opt/pnpm/bin/pnpm.cjs'
      },
      expected: 'npx'
    },
    {
      name: 'npm_execpath outranks NPM_EXEC_PATH',
      env: {
        npm_execpath: '/opt/pnpm/bin/pnpm.cjs',
        NPM_EXEC_PATH: '/opt/bun/bin/bun'
      },
      expected: 'pnpm'
    },
    {
      name: 'the path is matched whatever its case',
      env: {npm_execpath: 'C:\\Tools\\PNPM\\bin\\pnpm.cjs'},
      expected: 'pnpm'
    },
    {
      name: 'a yarn user agent with no version cannot be known for Berry',
      env: {npm_config_user_agent: 'yarn'},
      expected: 'npx'
    },
    {
      name: 'a path that names npm alone means npx',
      env: {npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js'},
      expected: 'npx'
    }
  ])('$name', ({env, expected}) => {
    expect(runner(env)).toBe(expected)
  })

  it('takes npm under a home folder containing "bun" for npm', () => {
    expect(
      runner({
        npm_execpath:
          '/home/ubuntu/.nvm/versions/node/v24.0.0/lib/node_modules/npm/bin/npm-cli.js'
      })
    ).toBe('npx')
  })

  // The entry file each manager names in npm_execpath, then folders that
  // carry another manager's name on the way to it.
  it.each([
    ['/usr/lib/node_modules/npm/bin/npm-cli.js', 'npm'],
    ['/usr/lib/node_modules/npm/bin/npx-cli.js', 'npm'],
    ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'npm'],
    ['/opt/pnpm/bin/pnpm.cjs', 'pnpm'],
    ['/opt/pnpm/bin/pnpm.mjs', 'pnpm'],
    ['/opt/pnpm/bin/pnpx.cjs', 'pnpm'],
    ['/home/dev/.local/share/pnpm/pnpm', 'pnpm'],
    ['C:\\Users\\dev\\AppData\\Local\\pnpm\\pnpm.exe', 'pnpm'],
    ['C:\\Tools\\PNPM\\bin\\PNPM.CJS', 'pnpm'],
    ['/usr/share/yarn/bin/yarn.js', 'yarn'],
    ['/project/.yarn/releases/yarn-4.1.0.cjs', 'yarn'],
    ['/home/dev/.cache/node/corepack/v1/yarn/4.17.1/yarn.js', 'yarn'],
    ['/home/dev/.bun/bin/bun', 'bun'],
    ['/home/dev/.bun/bin/bunx', 'bun'],
    ['C:\\Users\\dev\\.bun\\bin\\bun.exe', 'bun'],
    ['/home/ubuntu/lib/node_modules/npm/bin/npm-cli.js', 'npm'],
    ['/home/bun/lib/node_modules/npm/bin/npm-cli.js', 'npm'],
    ['/opt/pnpm-store/node_modules/npm/bin/npm-cli.js', 'npm'],
    ['/work/yarn-workspace/node_modules/npm/bin/npm-cli.js', 'npm'],
    ['/opt/tools/bundle.js', 'npm'],
    ['/opt/tools/yarnish.js', 'npm'],
    ['/opt/tools/pnpm-lock.yaml', 'npm'],
    ['', 'npm']
  ])('reads %s as %s', (execPath, manager) => {
    expect(packageManagerFromExecPath(execPath)).toBe(manager)
  })
})

describe('buildExecEnv, the PATH a Windows child finds node on', () => {
  const NODE = 'C:\\Program Files\\nodejs\\node.exe'
  const NODE_DIR = 'C:\\Program Files\\nodejs'

  function execEnv(
    base: Record<string, string>,
    platform?: NodeJS.Platform,
    execPath?: string
  ): NodeJS.ProcessEnv {
    return buildExecEnv(base as NodeJS.ProcessEnv, platform, execPath)
  }

  it.each([
    'linux',
    'darwin'
  ] as const)('hands the environment back untouched on %s', (platform) => {
    const base = {PATH: '/usr/bin'}

    expect(execEnv(base, platform, '/opt/node/bin/node')).toBe(base)
  })

  it('puts the folder of the running node first, on PATH and on Path', () => {
    const base = {PATH: 'C:\\Windows;C:\\tools', Path: 'ignored', KEPT: '1'}
    const given = {...base}

    expect(execEnv(base, 'win32', NODE)).toEqual({
      KEPT: '1',
      PATH: `${NODE_DIR};C:\\Windows;C:\\tools`,
      Path: `${NODE_DIR};C:\\Windows;C:\\tools`
    })

    expect(base).toEqual(given)
  })

  it('reads Path when PATH is not set, and writes both', () => {
    expect(execEnv({Path: 'C:\\Windows'}, 'win32', NODE)).toEqual({
      PATH: `${NODE_DIR};C:\\Windows`,
      Path: `${NODE_DIR};C:\\Windows`
    })
  })

  // An empty entry on a Windows PATH is the current folder, so none is added.
  it.each([
    ['neither is set', {}],
    ['PATH is blank', {PATH: '  '}]
  ])('names the node folder alone when %s', (_name, base) => {
    expect(execEnv(base, 'win32', NODE)).toEqual({
      ...base,
      PATH: NODE_DIR,
      Path: NODE_DIR
    })
  })

  it.each([
    ['as written', `C:\\Windows;${NODE_DIR};C:\\tools`],
    ['in another case', 'C:\\Windows;c:\\program files\\NODEJS'],
    ['with a last backslash', `${NODE_DIR}\\;C:\\Windows`]
  ])('hands the environment back untouched when the folder is named %s', (_name, PATH) => {
    const base = {PATH}

    expect(execEnv(base, 'win32', NODE)).toBe(base)
  })

  it('adds the node folder when only a longer folder starts with its name', () => {
    expect(
      execEnv({PATH: `${NODE_DIR}-old;C:\\Windows`}, 'win32', NODE)
    ).toEqual({
      PATH: `${NODE_DIR};${NODE_DIR}-old;C:\\Windows`,
      Path: `${NODE_DIR};${NODE_DIR}-old;C:\\Windows`
    })
  })

  it('reads the process for the platform and the node binary left out', () => {
    const base = {PATH: path.dirname(process.execPath)}

    expect(execEnv(base)).toBe(base)
  })
})

describe('isEdgePrivilegeEscalationFailure, given the installer output', () => {
  it.each([
    'sudo: a password is required',
    'sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper',
    'SUDO:   A Password Is Required',
    'Installing dependencies...\nsudo: a terminal is required to read the password\nFailed to install browsers'
  ])('takes "%s" for a sudo that could not prompt', (text) => {
    expect(isEdgePrivilegeEscalationFailure(text)).toBe(true)
  })

  it.each([
    'su: Authentication failure',
    'Password: \nsu: Authentication failure',
    'su: must be run from a terminal',
    'sudo: no tty present and no askpass program specified'
  ])('takes "%s" for an escalation that got no password', (text) => {
    expect(isEdgePrivilegeEscalationFailure(text)).toBe(true)
  })

  it.each([
    'random error',
    '',
    'sudo: command not found',
    'sudo:a password is required',
    'E: sudo: a password is required',
    'Switching to root user to install dependencies...',
    'SWITCHING TO ROOT USER TO INSTALL DEPENDENCIES...'
  ])('does not take "%s" for one', (text) => {
    expect(isEdgePrivilegeEscalationFailure(text)).toBe(false)
  })

  it('reads a missing stream as no failure', () => {
    expect(
      isEdgePrivilegeEscalationFailure(undefined as unknown as string)
    ).toBe(false)
  })

  // Playwright prints the root switch before every attempt that is not root,
  // so only what sudo or su answered after it says the escalation failed.
  it('reads the failure line beside the root-switch line, never the switch itself', () => {
    const announced = 'Switching to root user to install dependencies...'

    expect(
      isEdgePrivilegeEscalationFailure(
        `${announced}\nE: Failed to fetch http://packages.microsoft.com Temporary failure resolving`
      )
    ).toBe(false)

    expect(
      isEdgePrivilegeEscalationFailure(
        `${announced}\nsu: Authentication failure`
      )
    ).toBe(true)
  })
})

describe('edgeInstallNeedsInteractivePrivilegedSession', () => {
  it.each([
    {platform: 'linux', stdinIsTTY: false, expected: true},
    {platform: 'linux', stdinIsTTY: true, expected: false},
    {platform: 'darwin', stdinIsTTY: false, expected: false},
    {platform: 'win32', stdinIsTTY: false, expected: false},
    {platform: 'freebsd', stdinIsTTY: false, expected: false}
  ] as const)('$platform with a terminal: $stdinIsTTY needs one: $expected', ({
    platform,
    stdinIsTTY,
    expected
  }) => {
    expect(
      edgeInstallNeedsInteractivePrivilegedSession(platform, stdinIsTTY)
    ).toBe(expected)
  })

  it('reads the process for whatever the caller leaves out', () => {
    expect(edgeInstallNeedsInteractivePrivilegedSession()).toBe(
      process.platform === 'linux' && !process.stdin.isTTY
    )

    expect(edgeInstallNeedsInteractivePrivilegedSession('linux')).toBe(
      !process.stdin.isTTY
    )
  })
})

describe('lookupOnPath, one which or where answer', () => {
  function answering(status: number | null, stdout: string) {
    return vi.fn((_tool: string, _args: string[]) => ({status, stdout}))
  }

  it('asks the tool for the one name and returns the path it prints', () => {
    const run = answering(0, '/usr/bin/microsoft-edge-stable\n')

    expect(lookupOnPath('which', 'microsoft-edge-stable', run)).toBe(
      '/usr/bin/microsoft-edge-stable'
    )

    expect(run.mock.calls).toEqual([['which', ['microsoft-edge-stable']]])
  })

  it.each([
    {
      name: 'the first of several where matches',
      stdout:
        'C:\\Program Files\\Microsoft\\Edge\\msedge.exe\r\n' +
        'C:\\Users\\dev\\msedge.exe\r\n',
      expected: 'C:\\Program Files\\Microsoft\\Edge\\msedge.exe'
    },
    {
      name: 'the first line that is not blank, trimmed',
      stdout: '\n   \n  /opt/edge/microsoft-edge  \n/usr/bin/other\n',
      expected: '/opt/edge/microsoft-edge'
    }
  ])('returns $name', ({stdout, expected}) => {
    expect(lookupOnPath('where', 'msedge', answering(0, stdout))).toBe(expected)
  })

  it.each([
    {name: 'a non-zero exit', status: 1, stdout: '/usr/bin/ignored\n'},
    {name: 'a tool that could not start', status: null, stdout: ''},
    {name: 'a zero exit that printed a blank line', status: 0, stdout: '\n'},
    {name: 'a zero exit that printed nothing', status: 0, stdout: ''}
  ])('returns null on $name', ({status, stdout}) => {
    expect(lookupOnPath('which', 'msedge', answering(status, stdout))).toBe(
      null
    )
  })

  it('runs the real tool when none is given, and finds no such name', () => {
    const tool = process.platform === 'win32' ? 'where' : 'which'

    expect(lookupOnPath(tool, 'extjs-no-such-browser-binary')).toBe(null)
  })
})
