import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerDevCommand} from '../commands/dev'
import {setupParentWatchdog} from '../helpers/parent-watchdog'
import {SUPPORTED_BROWSER_TARGETS} from '../helpers/vendors'
import {
  makeProgram,
  runCli,
  stubCommandEnv,
  stubProcessExit
} from './command-harness'
import {developStandIn} from './helpers/engine-stand-ins'
import {trackTempFolders} from './helpers/temp-folders'

// A real folder: a typed path that is not there is refused before the engine.
const PROJECT = trackTempFolders()('extjs-dev-spec-')

type EngineCall = [projectPath: string, options: Record<string, unknown>]
type DevDeps = NonNullable<Parameters<typeof registerDevCommand>[1]>

const engineCalls: EngineCall[] = []
const configReads: unknown[][] = []
const waitInputs: unknown[] = []
const watchdogs: Array<[pid: number, options: {emitFrame: () => void}]> = []
const packagerOptions: unknown[] = []
const packaged: unknown[][] = []

let commandConfig: unknown = {}
let preflightIssue: string | null = null

let engine: (...call: EngineCall) => Promise<void> = async () => {}

const launcher = (async () => {}) as unknown as NonNullable<DevDeps['launcher']>

// What the command told telemetry about the browsers of the run.
const notedBrowsers: string[][] = []

const deps: DevDeps = {
  noteBrowsers: (resolved) => {
    notedBrowsers.push([...resolved])
  },
  // The real one sends a failure row through the CLI's own telemetry.
  reportFailure: () => {},
  loadDevelop: async () =>
    developStandIn({
      extensionDev: async (...call: EngineCall) => {
        engineCalls.push(call)
        await engine(...call)
      },
      loadCommandConfig: async (...args: unknown[]) => {
        configReads.push(args)

        return commandConfig
      }
    }),
  launcher,
  safariPreflight: () => preflightIssue,
  armParentWatchdog: ((pid: number, options: {emitFrame: () => void}) => {
    watchdogs.push([pid, options])
  }) as never,
  waitForReady: (async (input: unknown) => {
    waitInputs.push(input)

    return {
      format: 'json',
      browsers: ['chromium'],
      results: [{browser: 'chromium', ok: true}]
    }
  }) as never,
  // The real packager drives Xcode, so the factory records what dev asked of it.
  createPackager: ((options: unknown) => {
    packagerOptions.push(options)

    return async (...args: unknown[]) => {
      packaged.push(args)
    }
  }) as never
}

let stdout: string[]
let stderr: string[]

beforeEach(() => {
  stdout = []
  stderr = []
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation((line) => {
    stdout.push(String(line))
  })

  vi.spyOn(console, 'error').mockImplementation((line) => {
    stderr.push(String(line))
  })

  stubCommandEnv()
})

afterEach(() => {
  notedBrowsers.length = 0
  vi.unstubAllEnvs()
  vi.restoreAllMocks()

  for (const list of [
    engineCalls,
    configReads,
    waitInputs,
    watchdogs,
    packagerOptions,
    packaged
  ]) {
    list.length = 0
  }

  commandConfig = {}
  preflightIssue = null

  engine = async () => {}
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) => registerDevCommand(program, deps)),
    argv
  )
}

function frames(): unknown[] {
  return stdout.map((line) => JSON.parse(line))
}

// Every spelling commander accepts for dev, read from the registered options.
function registeredFlags(): string[] {
  const dev = makeProgram(registerDevCommand).commands.find(
    (command) => command.name() === 'dev'
  )

  return (dev?.options ?? []).flatMap((option) =>
    [option.short, option.long].filter((flag): flag is string => Boolean(flag))
  )
}

function flagsIn(argv: string[]): string[] {
  return argv
    .filter((arg) => arg.startsWith('-'))
    .map((arg) => arg.split('=')[0])
}

// What extensionDev receives when no flag is typed. A row states only the keys
// its flags change, and the whole object is compared.
const UNTYPED = {
  browser: 'chromium',
  exitOnError: true,
  noBrowser: false,
  logTimestamps: undefined,
  logColor: undefined,
  profile: undefined,
  chromiumBinary: undefined,
  geckoBinary: undefined,
  polyfill: undefined,
  noOpen: undefined,
  macOsOnly: undefined,
  startingUrl: undefined,
  install: undefined,
  extensions: undefined,
  logLevel: undefined,
  logContexts: undefined,
  logFormat: undefined,
  logUrl: undefined,
  logTab: undefined,
  firefoxBinary: undefined,
  safariBinary: undefined,
  appName: undefined,
  bundleId: undefined,
  developmentTeam: undefined,
  appIcon: undefined,
  forceRegenerate: undefined,
  port: undefined,
  host: undefined,
  publicHost: undefined,
  allowedHosts: undefined,
  authorMode: undefined,
  allowControl: undefined,
  allowEval: undefined,
  launcher,
  onReady: expect.any(Function),
  onSessionStart: expect.any(Function),
  onExitError: expect.any(Function),
  safariPackager: expect.any(Function)
}

interface ForwardingRow {
  argv: string[]
  env?: Record<string, string>
  config?: unknown
  options: Record<string, unknown>
}

const SAFARI = ['--browser', 'safari']

// A flag that only steers the CLI (--wait, --output, --parent-pid) rows {}:
// the engine gets named keys, never the parsed flags themselves.
const FORWARDING: ForwardingRow[] = [
  {argv: [], options: {}},
  {argv: [], config: {browser: 'firefox'}, options: {browser: 'firefox'}},
  {
    argv: ['--browser', 'edge'],
    config: {browser: 'firefox'},
    options: {browser: 'edge'}
  },
  {argv: ['-b', 'firefox'], options: {browser: 'firefox'}},
  {
    argv: [],
    env: {EXTENSION_CLI_NO_BROWSER: '1'},
    options: {noBrowser: true, launcher: undefined}
  },
  {
    argv: [],
    config: {noBrowser: true},
    options: {noBrowser: true, launcher: undefined}
  },
  {argv: ['--profile', 'false'], options: {profile: false}},
  {
    argv: ['--profile', '/tmp/my-profile'],
    options: {profile: '/tmp/my-profile'}
  },
  {
    argv: ['--chromium-binary', '/bin/chromium'],
    options: {chromiumBinary: '/bin/chromium'}
  },
  {
    argv: ['--gecko-binary', '/bin/gecko'],
    options: {geckoBinary: '/bin/gecko'}
  },
  {
    argv: ['--firefox-binary', '/bin/firefox'],
    options: {geckoBinary: '/bin/firefox', firefoxBinary: '/bin/firefox'}
  },
  {
    argv: [...SAFARI, '--safari-binary', '/bin/safari'],
    options: {browser: 'safari', safariBinary: '/bin/safari'}
  },
  {
    argv: [...SAFARI, '--app-name', 'My App'],
    options: {browser: 'safari', appName: 'My App'}
  },
  {
    argv: [...SAFARI, '--bundle-id', 'dev.example.app'],
    options: {browser: 'safari', bundleId: 'dev.example.app'}
  },
  {
    argv: [...SAFARI, '--development-team', 'ABCDE12345'],
    options: {browser: 'safari', developmentTeam: 'ABCDE12345'}
  },
  {
    argv: [...SAFARI, '--macos-only'],
    options: {browser: 'safari', macOsOnly: true}
  },
  {
    argv: [...SAFARI, '--macos-only', 'false'],
    options: {browser: 'safari', macOsOnly: false}
  },
  {
    argv: [...SAFARI, '--app-icon', './icon.png'],
    options: {browser: 'safari', appIcon: './icon.png'}
  },
  {
    argv: [...SAFARI, '--force-regenerate'],
    options: {browser: 'safari', forceRegenerate: true}
  },
  {
    // It reaches the Safari packager, not the engine.
    argv: [...SAFARI, '--enable-extension'],
    options: {browser: 'safari'}
  },
  {argv: ['--polyfill'], options: {polyfill: true}},
  {argv: ['--polyfill', 'false'], options: {polyfill: false}},
  {argv: ['--no-polyfill'], options: {polyfill: false}},
  {argv: ['--no-open'], options: {noOpen: true}},
  {
    argv: ['--starting-url', 'https://example.com'],
    options: {startingUrl: 'https://example.com'}
  },
  {argv: ['--port', '9000'], options: {port: '9000'}},
  {argv: ['--port', '0'], options: {port: '0'}},
  {argv: ['--host', '0.0.0.0'], options: {host: '0.0.0.0'}},
  {
    argv: ['--public-host', '203.0.113.7'],
    options: {publicHost: '203.0.113.7'}
  },
  {
    argv: ['--allowed-hosts', 'web,.example.test'],
    options: {allowedHosts: 'web,.example.test'}
  },
  {
    argv: ['--log-context', 'background, nope ,content'],
    options: {logContexts: ['background', 'content']}
  },
  {argv: ['--log-context', 'all'], options: {}},
  {argv: ['--logs', 'debug'], options: {logLevel: 'debug'}},
  // The flag is read in any case, and the engine compares the level exactly.
  {argv: ['--logs', ' OFF '], options: {logLevel: 'off'}},
  {argv: ['--log-format', 'json'], options: {logFormat: 'json'}},
  {argv: ['--no-log-timestamps'], options: {logTimestamps: false}},
  {argv: ['--no-log-color'], options: {logColor: false}},
  {argv: ['--log-url', '/api/i'], options: {logUrl: '/api/i'}},
  {argv: ['--log-tab', '12'], options: {logTab: '12'}},
  {
    argv: ['--extensions', 'a, ,b'],
    options: {extensions: ['a', 'b']}
  },
  {argv: ['--install'], options: {install: true}},
  {argv: ['--install', 'false'], options: {install: false}},
  {argv: ['--wait', 'false'], options: {}},
  {argv: ['--output', 'json'], options: {exitOnError: false}},
  {argv: ['--output', 'pretty'], options: {}},
  {
    argv: ['--wait-format', 'json'],
    options: {exitOnError: false}
  },
  {argv: ['--debug'], options: {}},
  {argv: ['--author'], options: {authorMode: true}},
  {argv: ['--author-mode'], options: {authorMode: true}},
  {argv: ['--allow-control'], options: {allowControl: true}},
  {argv: ['--allow-eval'], options: {allowEval: true}},
  {argv: ['--parent-pid', '4242'], options: {}}
]

describe('extension dev flag forwarding', () => {
  it('has a row for every flag the command registers', () => {
    // A flag that is only ever refused alone is typed in the refusal table.
    const typed = new Set(
      [...FORWARDING, ...REFUSALS].flatMap((row) => flagsIn(row.argv))
    )

    expect(registeredFlags().filter((flag) => !typed.has(flag))).toEqual([])
  })

  it.each(
    FORWARDING
  )('hands extensionDev the options of dev $argv (env $env, config $config)', async ({
    argv,
    env = {},
    config = {},
    options
  }) => {
    commandConfig = config
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

    expect(await run(['dev', PROJECT, ...argv])).toBe(0)
    expect(engineCalls).toEqual([[PROJECT, {...UNTYPED, ...options}]])
  })

  it('reads the project config for the dev command before it picks a browser', async () => {
    expect(await run(['dev', PROJECT])).toBe(0)
    expect(configReads[0]).toEqual([PROJECT, 'dev'])
  })
})

interface RefusalRow {
  name: string
  argv: string[]
  env?: Record<string, string>
  preflight?: string
  stderr: string[]
  frame: {status: string; error: {code: string; message: string}}
}

const EVERY_TARGET = SUPPORTED_BROWSER_TARGETS.join(', ')

const WHOLE_NUMBER_USE = {
  '--parent-pid': 'Use the process id to watch, in digits, such as 4242.',
  '--wait-timeout': 'Use a whole number of milliseconds, such as 10000.',
  '--port':
    'Use a whole number from 0 to 65535, such as 8080. 0 picks a free port.'
} as const

function wholeNumberRefusal(
  flag: keyof typeof WHOLE_NUMBER_USE,
  value: string
): RefusalRow {
  const message = `${flag} got "${value}". ${WHOLE_NUMBER_USE[flag]}`

  return {
    name: `${flag} ${value}`,
    argv: [flag, value],
    stderr: [`⏵⏵⏵ ${message}`],
    frame: {status: 'usage', error: {code: 'E_INVALID_OPTION', message}}
  }
}

const REFUSALS: RefusalRow[] = [
  ...[
    ['--wait-timeout', '5000'],
    ['--wait', 'false', '--wait-timeout', '5000']
  ].map(
    (argv): RefusalRow => ({
      name: `${argv.join(' ')} with no wait to time`,
      argv,
      stderr: [
        '⏵⏵⏵ --wait-timeout applies only with --wait. Add --wait, or drop --wait-timeout.'
      ],
      frame: {
        status: 'usage',
        error: {
          code: 'E_INVALID_OPTION',
          message:
            '--wait-timeout applies only with --wait. Add --wait, or drop --wait-timeout.'
        }
      }
    })
  ),
  ...(
    [
      ['--parent-pid', 'zero'],
      ['--parent-pid', '1e3'],
      ['--parent-pid', '12abc'],
      ['--parent-pid', '0'],
      ['--wait-timeout', '10s'],
      ['--wait-timeout', '0'],
      ['--wait-timeout', '-5'],
      ['--port', 'abc'],
      ['--port', '1.5'],
      ['--port', '-1'],
      ['--port', '70000']
    ] as const
  ).map(([flag, value]) => wholeNumberRefusal(flag, value)),
  {
    name: 'a browser name nobody supports',
    argv: ['--browser', 'netscape'],
    stderr: [
      `⏵⏵⏵ Unsupported --browser value: netscape.\nChoose one of: ${EVERY_TARGET}.`
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_UNSUPPORTED_BROWSER',
        message: `Unsupported browser: netscape. Choose one of: ${EVERY_TARGET}.`
      }
    }
  },
  {
    name: 'a safari-only flag on a chromium target',
    argv: ['--bundle-id', 'dev.example.app'],
    stderr: [
      '⏵⏵⏵ --bundle-id only applies to Safari targets.\nAdd --browser safari (or webkit-based).'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message: '--bundle-id applies to safari targets only.'
      }
    }
  },
  {
    name: 'several safari-only flags on a chromium target',
    argv: ['--app-name', 'My App', '--force-regenerate'],
    stderr: [
      '⏵⏵⏵ --app-name, --force-regenerate only apply to Safari targets.\nAdd --browser safari (or webkit-based).'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message: '--app-name, --force-regenerate apply to safari targets only.'
      }
    }
  },
  {
    // `false` is a real value for this flag, not an unset boolean, so the
    // safari-only gate has to notice it rather than filter it out.
    name: '--macos-only false on a chromium target',
    argv: ['--macos-only', 'false'],
    stderr: [
      '⏵⏵⏵ --macos-only only applies to Safari targets.\nAdd --browser safari (or webkit-based).'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message: '--macos-only applies to safari targets only.'
      }
    }
  },
  {
    name: 'a malformed safari bundle id',
    argv: ['--browser', 'safari', '--bundle-id', 'bad id'],
    stderr: [
      '⏵⏵⏵ --bundle-id got "bad id". Use reverse DNS form, such as com.example.bad-id.'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message:
          '--bundle-id got "bad id". Use reverse DNS form, such as com.example.bad-id.'
      }
    }
  },
  {
    name: 'a safari bundle id with no dot',
    argv: ['--browser', 'safari', '--bundle-id', 'myapp'],
    stderr: [
      '⏵⏵⏵ --bundle-id got "myapp". Use reverse DNS form, such as com.example.myapp.'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message:
          '--bundle-id got "myapp". Use reverse DNS form, such as com.example.myapp.'
      }
    }
  },
  {
    name: 'a safari bundle id of symbols only',
    argv: ['--browser', 'safari', '--bundle-id', '!!'],
    stderr: [
      '⏵⏵⏵ --bundle-id got "!!". Use reverse DNS form, such as com.example.my-extension.'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message:
          '--bundle-id got "!!". Use reverse DNS form, such as com.example.my-extension.'
      }
    }
  },
  {
    name: 'a safari toolchain the preflight rejects',
    argv: ['--browser', 'safari'],
    preflight: 'xcode missing',
    stderr: ['xcode missing'],
    frame: {
      status: 'failed',
      error: {code: 'E_SAFARI_TOOLCHAIN', message: 'xcode missing'}
    }
  },
  {
    // Same process, both flags: --wait never starts a server, so the run used
    // to sit on the ready contract for the whole --wait-timeout and then fail.
    name: '--no-browser with --wait',
    argv: ['--wait', '--wait-timeout', '45000'],
    env: {EXTENSION_CLI_NO_BROWSER: '1'},
    stderr: [
      '⏵⏵⏵ --no-browser and --wait cannot run in the same process.\n--no-browser runs the server without a browser, and --wait only reads the ready contract another process writes.\nRUN extension dev --no-browser\nTHEN extension dev --wait --output json in a second process'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message:
          '--no-browser and --wait cannot run in the same process. Run `extension dev --no-browser` in one process and `extension dev --wait` in another.'
      }
    }
  }
]

describe.each(REFUSALS)('extension dev refuses $name', (row) => {
  beforeEach(() => {
    preflightIssue = row.preflight ?? null

    for (const [name, value] of Object.entries(row.env ?? {})) {
      vi.stubEnv(name, value)
    }
  })

  function expectNothingRan() {
    expect(engineCalls).toEqual([])
    expect(waitInputs).toEqual([])
    expect(watchdogs).toEqual([])
  }

  it('on stderr, with exit 1 and nothing run', async () => {
    expect(await run(['dev', '.', ...row.argv])).toBe(1)
    expect(stderr).toEqual(row.stderr)
    expect(stdout).toEqual([])
    expectNothingRan()
  })

  it('as one frame and no prose under --output json', async () => {
    expect(await run(['dev', '.', ...row.argv, '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'dev',
        value: null,
        warnings: [],
        ...row.frame
      }
    ])

    expect(stderr).toEqual([])
    expectNothingRan()
  })
})

describe('extension dev', () => {
  it.each([
    [[], false],
    [['--no-open'], true]
  ])('wires a safari packager that follows the --no-open decision of %j', async (flags, noOpen) => {
    expect(await run(['dev', '.', ...flags])).toBe(0)

    const packager = engineCalls[0][1].safariPackager as (
      distPath: string,
      mode: string
    ) => Promise<void>
    await packager('/tmp/dist/safari', 'resync')

    expect(packagerOptions).toEqual([
      {
        browser: 'chromium',
        noOpen,
        announceDevReady: true,
        enableExtension: false
      }
    ])

    expect(packaged).toEqual([['/tmp/dist/safari', 'resync']])
  })

  it('arms the parent watchdog with a valid --parent-pid', async () => {
    expect(await run(['dev', '.', '--parent-pid', '4242'])).toBe(0)
    expect(watchdogs).toEqual([[4242, {emitFrame: expect.any(Function)}]])
  })

  it('frames a parent-gone shutdown under --output json', async () => {
    expect(
      await run(['dev', '.', '--parent-pid', '4242', '--output', 'json'])
    ).toBe(0)

    stdout.length = 0
    watchdogs[0][1].emitFrame()

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'dev',
        status: 'failed',
        value: null,
        error: {
          code: 'E_PARENT_GONE',
          message:
            'the --parent-pid owner (process 4242) is gone, so this dev session is shutting down'
        },
        warnings: []
      }
    ])
  })

  it('prints no parent-gone frame without --output json', async () => {
    expect(await run(['dev', '.', '--parent-pid', '4242'])).toBe(0)
    watchdogs[0][1].emitFrame()

    expect(stdout).toEqual([])
  })

  it.each([
    '--debug',
    '--author',
    '--author-mode'
  ])('enables maintainer diagnostics with %s', async (flag) => {
    expect(await run(['dev', '.', flag])).toBe(0)
    expect(process.env.EXTENSION_DEBUG).toBe('1')
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })

  it('sets EXTENSION_OUTPUT to json before the dev server runs', async () => {
    let seen: string | undefined = 'never ran'

    engine = async () => {
      seen = process.env.EXTENSION_OUTPUT
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)
    expect(seen).toBe('json')
  })

  it('leaves EXTENSION_OUTPUT alone in pretty mode', async () => {
    expect(await run(['dev', '.'])).toBe(0)
    expect(engineCalls).toHaveLength(1)
    expect(process.env.EXTENSION_OUTPUT).toBeUndefined()
  })
})

// A start failure reaches the command as a rejection. The engine may have
// written the terminal frame already, and it says so on the error.
describe('extension dev when the engine fails to start under --output json', () => {
  const startFailure = (extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('listen EADDRINUSE'), {
      code: 'E_DEV_SERVER_START',
      ...extra
    })

  it('prints the one failed frame when the engine wrote none', async () => {
    engine = async () => {
      throw startFailure()
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)

    expect(frames()).toMatchObject([
      {
        ok: false,
        command: 'dev',
        status: 'failed',
        error: {code: 'E_DEV_SERVER_START', message: 'listen EADDRINUSE'}
      }
    ])
  })

  it('carries the session the engine put on the error as the frame value', async () => {
    const session = {pid: 4242, port: 8080, readyPath: '/tmp/ready.json'}

    engine = async () => {
      throw startFailure({session})
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toMatchObject([{status: 'failed', value: session}])
  })

  it('leaves the frame value null when the error names no session', async () => {
    engine = async () => {
      throw startFailure()
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toMatchObject([{status: 'failed', value: null}])
  })

  it.each([
    ['false', false],
    ['a truthy value that is not true', 'yes']
  ])('still prints its frame when framed is %s', async (_name, framed) => {
    engine = async () => {
      throw startFailure({framed})
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toHaveLength(1)
  })

  it('prints no second frame when the engine already wrote it, and still exits 1', async () => {
    engine = async () => {
      throw startFailure({framed: true})
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(stdout).toEqual([])
  })
})

// The engine ends a session whose restart left no server by writing its own
// terminal frame and calling onExitError. Under --output json it never exits.
describe('extension dev after the engine ends a running session', () => {
  const lostServer = Object.assign(new Error('listen EADDRINUSE'), {
    code: 'E_DEV_SERVER_START'
  })

  const drainedExits: Array<{code: number; reportedFirst: boolean}> = []

  async function endSession(argv: string[]) {
    const reported: unknown[] = []

    deps.reportFailure = (details) => {
      reported.push(details)
    }

    deps.exitDrained = async (code) => {
      drainedExits.push({code, reportedFirst: reported.length === 1})
    }

    expect(await run(argv)).toBe(0)
    stdout.length = 0

    const onExitError = engineCalls[0][1].onExitError as (
      error: unknown,
      code?: string
    ) => void

    onExitError(lostServer, 'E_DEV_SERVER_START')

    return reported
  }

  beforeEach(() => {
    deps.exitDrained = async (code) => {
      drainedExits.push({code, reportedFirst: false})
    }
  })

  afterEach(() => {
    drainedExits.length = 0

    deps.reportFailure = () => {}

    delete deps.exitDrained
  })

  it('exits 1 after the report under --output json, with no frame of its own', async () => {
    const reported = await endSession(['dev', '.', '--output', 'json'])

    expect(reported).toEqual([
      {
        code: 'E_DEV_SERVER_START',
        exitCode: 1,
        error: lostServer,
        step: 'engine'
      }
    ])

    expect(drainedExits).toEqual([{code: 1, reportedFirst: true}])
    expect(stdout).toEqual([])
  })

  it('ends the real process with code 1 when no exit is injected', async () => {
    delete deps.exitDrained

    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)

    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)
    stdout.length = 0

    const onExitError = engineCalls[0][1].onExitError as (
      error: unknown
    ) => void

    onExitError(lostServer)

    // The exit waits for stdout to be written out, so it lands a turn later.
    expect(exit).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(exit).toHaveBeenCalledTimes(1)
    expect(stdout).toEqual([])
  })

  it('still exits when the report throws', async () => {
    deps.reportFailure = () => {
      throw new Error('telemetry is down')
    }

    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)

    const onExitError = engineCalls[0][1].onExitError as (
      error: unknown
    ) => void

    expect(() => onExitError(lostServer)).not.toThrow()
    expect(drainedExits.map(({code}) => code)).toEqual([1])
  })

  it('leaves the exit to the engine in pretty mode, which ends the process itself', async () => {
    const reported = await endSession(['dev', '.'])

    expect(reported).toEqual([
      {
        code: 'E_DEV_SERVER_START',
        exitCode: 1,
        error: lostServer,
        step: 'engine'
      }
    ])

    expect(drainedExits).toEqual([])
    expect(process.exit).not.toHaveBeenCalled()
  })
})

// The real watchdog over an engine that writes one terminal frame per session,
// as the lifecycle stream does. No signal leaves the test process.
describe('extension dev when the --parent-pid owner goes away', () => {
  const PARENT_GONE =
    'the --parent-pid owner (process 4242) is gone, so this dev session is shutting down'
  const TERMINAL = new Set(['failed', 'usage', 'stopped'])
  const POLL_MS = 1000

  let parentAlive = true
  let sessionLive = false
  let ended = false
  let kill: ReturnType<typeof vi.spyOn>
  let endSessionAsFailed: ReturnType<typeof vi.fn>

  const engineFrame = (status: string, error: unknown) => {
    if (ended) return

    ended = true
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({schema: 1, ok: false, command: 'dev', status, error})
    )
  }

  beforeEach(() => {
    parentAlive = true
    sessionLive = false
    ended = false
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })

    kill = vi.spyOn(process, 'kill').mockImplementation(((
      pid: number,
      signal?: string
    ) => {
      // The engine's signal handler ends a live session with its stop frame.
      if (pid === process.pid && signal === 'SIGTERM' && sessionLive) {
        engineFrame('stopped', null)
      }

      return true
    }) as never)

    endSessionAsFailed = vi.fn((code: string, message: string) => {
      if (!sessionLive) return false

      engineFrame('failed', {code, message})

      return true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function runWithRealWatchdog(argv: string[]) {
    const realDeps: DevDeps = {
      ...deps,
      armParentWatchdog: (pid, options) =>
        setupParentWatchdog(pid, {
          ...options,
          isAlive: () => parentAlive,
          pollIntervalMs: POLL_MS
        }),
      loadDevelop: async () =>
        developStandIn({
          extensionDev: async () => {
            sessionLive = true
          },
          endSessionAsFailed,
          loadCommandConfig: async () => ({})
        })
    }

    return runCli(
      makeProgram((program) => registerDevCommand(program, realDeps)),
      argv
    )
  }

  const terminalFrames = () =>
    frames().filter((frame) =>
      TERMINAL.has(String((frame as {status?: unknown}).status))
    )

  it('writes two terminal frames once the session is live', async () => {
    expect(
      await runWithRealWatchdog([
        'dev',
        '.',
        '--parent-pid',
        '4242',
        '--output',
        'json'
      ])
    ).toBe(0)

    parentAlive = false
    vi.advanceTimersByTime(POLL_MS)

    expect(terminalFrames()).toMatchObject([
      {status: 'failed', error: {code: 'E_PARENT_GONE', message: PARENT_GONE}},
      {status: 'stopped'}
    ])

    expect(kill.mock.calls).toEqual([[process.pid, 'SIGTERM']])
  })

  it('frames the failure itself and signals itself before any session is live', async () => {
    parentAlive = false

    expect(
      await runWithRealWatchdog([
        'dev',
        '.',
        '--parent-pid',
        '4242',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(terminalFrames()).toMatchObject([
      {status: 'failed', error: {code: 'E_PARENT_GONE', message: PARENT_GONE}}
    ])

    expect(kill.mock.calls).toEqual([[process.pid, 'SIGTERM']])
  })
})

describe('extension dev --wait', () => {
  it.each([
    [['--wait'], {waitTimeout: undefined, waitFormat: 'pretty'}],
    [['--wait', 'true'], {waitTimeout: undefined, waitFormat: 'pretty'}],
    [
      ['--wait', '--wait-timeout', '5000'],
      {waitTimeout: '5000', waitFormat: 'pretty'}
    ],
    [
      ['--wait', '--output', 'json'],
      {waitTimeout: undefined, waitFormat: 'json'}
    ],
    [
      ['--wait', '--wait-format', 'json'],
      {waitTimeout: undefined, waitFormat: 'json'}
    ],
    [
      ['--wait', '--browser', 'chrome,firefox'],
      {
        browsers: ['chrome', 'firefox'],
        waitTimeout: undefined,
        waitFormat: 'pretty'
      }
    ]
  ])('hands wait mode the input of dev %j and starts no server', async (flags, input) => {
    expect(await run(['dev', PROJECT, ...flags])).toBe(0)
    expect(waitInputs).toEqual([
      {
        command: 'dev',
        pathOrRemoteUrl: PROJECT,
        browsers: ['chromium'],
        ...input
      }
    ])

    expect(engineCalls).toEqual([])
  })

  it('prints what wait mode found as one ready frame', async () => {
    expect(await run(['dev', '.', '--wait', '--wait-format', 'json'])).toBe(0)
    // The pre-envelope wait frame now rides inside value.
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'dev',
        status: 'ready',
        value: {
          mode: 'wait',
          command: 'dev',
          browsers: ['chromium'],
          results: [{browser: 'chromium', ok: true}]
        },
        error: null,
        warnings: []
      }
    ])
  })

  it('prints nothing on stdout for a pretty wait', async () => {
    expect(await run(['dev', '.', '--wait'])).toBe(0)
    expect(stdout).toEqual([])
  })

  it('still waits when noBrowser comes from extension.config.js', async () => {
    // The config value belongs to the producer process. Refusing on it would
    // break the documented two-process pattern for those projects.
    commandConfig = {noBrowser: true}
    expect(await run(['dev', '.', '--wait', '--output', 'json'])).toBe(0)
    expect(waitInputs).toHaveLength(1)
  })
})

describe('extension dev tells telemetry which browsers it resolved', () => {
  it.each<[string, string[], unknown, string[]]>([
    ['the default, with no flag and no config', [], {}, ['chromium']],
    ['the one the config file names', [], {browser: 'firefox'}, ['firefox']],
    [
      'the flag over the config file',
      ['--browser', 'edge'],
      {browser: 'firefox'},
      ['edge']
    ],
    [
      'every browser of a list',
      ['--browser', 'chrome,firefox'],
      {},
      ['chrome', 'firefox']
    ]
  ])('%s', async (_name, argv, config, expected) => {
    commandConfig = config

    await run(['dev', PROJECT, ...argv])

    expect(notedBrowsers).toEqual([expected])
  })

  it('tells nothing for a run refused before a browser is resolved', async () => {
    commandConfig = {browser: 'firefox'}

    expect(await run(['dev', PROJECT, '--output', 'xml'])).toBe(1)
    expect(notedBrowsers).toEqual([])
    expect(configReads).toEqual([])
  })
})

// An unclassified failure says what kind of error it was and where it was
// thrown, so the row tells a missing engine from an engine that threw.
describe('extension dev tells telemetry where an unclassified failure came from', () => {
  const reported: unknown[] = []

  function runWith(overrides: Partial<DevDeps>, argv: string[]) {
    return runCli(
      makeProgram((program) =>
        registerDevCommand(program, {
          ...deps,
          reportFailure: (details) => {
            reported.push(details)
          },
          ...overrides
        })
      ),
      argv
    )
  }

  afterEach(() => {
    reported.length = 0
  })

  it('names the engine when the engine rejects under --output json', async () => {
    const thrown = new TypeError('engine broke')

    engine = async () => {
      throw thrown
    }

    expect(await runWith({}, ['dev', PROJECT, '--output', 'json'])).toBe(1)
    expect(reported).toEqual([
      {code: 'E_INTERNAL', exitCode: 1, error: thrown, step: 'engine'}
    ])
  })

  it('names the engine for a failure the engine reports itself', async () => {
    const thrown = new RangeError('engine broke')

    engine = async (_path, options) => {
      ;(options.onExitError as (error: unknown) => void)(thrown)
    }

    expect(await runWith({}, ['dev', PROJECT])).toBe(0)
    expect(reported).toEqual([
      {code: 'E_INTERNAL', exitCode: 1, error: thrown, step: 'engine'}
    ])
  })

  it('names the engine load when the engine module cannot be loaded', async () => {
    let loads = 0

    const counting = async () => {
      loads += 1

      return deps.loadDevelop!()
    }

    expect(await runWith({loadDevelop: counting}, ['dev', PROJECT])).toBe(0)
    const loadsBeforeTheEngine = loads
    const thrown = Object.assign(new Error('Cannot find module'), {
      code: 'MODULE_NOT_FOUND'
    })

    loads = 0
    reported.length = 0

    const failing = async () => {
      loads += 1
      if (loads === loadsBeforeTheEngine) throw thrown

      return deps.loadDevelop!()
    }

    await expect(
      runWith({loadDevelop: failing}, ['dev', PROJECT])
    ).rejects.toBe(thrown)

    expect(reported).toEqual([
      {code: 'E_INTERNAL', exitCode: 1, error: thrown, step: 'engine_load'}
    ])
  })
})
