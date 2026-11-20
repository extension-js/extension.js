import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WaitModeError} from '../commands/dev-wait'
import {registerStartCommand} from '../commands/start'
import {CODES} from '../helpers/messaging'
import {
  isEmulatorVendor,
  isSafariVendor,
  SUPPORTED_BROWSER_TARGETS
} from '../helpers/vendors'
import {
  makeProgram,
  runCli,
  stubCommandEnv,
  stubProcessExit
} from './command-harness'
import {developStandIn, previewStandIn} from './helpers/engine-stand-ins'
import {trackTempFolders} from './helpers/temp-folders'

// A real folder: a typed path that is not there is refused before the engine.
const PROJECT = trackTempFolders()('extjs-start-spec-')

type EngineCall = [projectPath: string, options: Record<string, unknown>]
type StartDeps = NonNullable<Parameters<typeof registerStartCommand>[1]>

const builds: EngineCall[] = []
// The one call that sends a failure row, so a spec can read what would travel.
const reportFailure = vi.fn()
const previews: EngineCall[] = []
const browserRuns: unknown[] = []
const configReads: unknown[][] = []
const waitInputs: unknown[] = []
// The order things happened in, stdout lines included.
const events: string[] = []

const READY = {
  format: 'json',
  browsers: ['chromium'],
  results: [{browser: 'chromium', ok: true}]
}

let commandConfig: unknown = {}

let build: () => Promise<void> = async () => {}

let preview: () => Promise<void> = async () => {}

let wait: () => Promise<unknown> = async () => READY

// Only waitForReady is faked on the wait path: describeWaitError is the code
// under test there.
// What the command told telemetry about the browsers of the run.
const notedBrowsers: string[][] = []

const deps: StartDeps = {
  noteBrowsers: (resolved) => {
    notedBrowsers.push([...resolved])
  },
  loadDevelop: async () =>
    developStandIn({
      extensionBuild: async (...call: EngineCall) => {
        events.push('build')
        builds.push(call)
        await build()
      },
      loadCommandConfig: async (...args: unknown[]) => {
        configReads.push(args)

        return commandConfig
      }
    }),
  loadPreview: async () =>
    previewStandIn({
      extensionPreview: async (
        projectPath: string,
        options: Record<string, unknown>,
        runBrowser: (launch: unknown) => unknown
      ) => {
        events.push('preview')
        previews.push([projectPath, options])
        await preview()
        await runBrowser({launched: true})
      }
    }),
  runBrowser: (async (launch: unknown) => {
    browserRuns.push(launch)
  }) as never,
  waitForReady: (async (input: unknown) => {
    waitInputs.push(input)

    return wait()
  }) as never,
  reportFailure
}

let stdout: string[]
let stderr: string[]

beforeEach(() => {
  stdout = []
  stderr = []
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation((line) => {
    events.push('stdout')
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
  reportFailure.mockClear()

  for (const list of [
    builds,
    previews,
    browserRuns,
    configReads,
    waitInputs,
    events
  ]) {
    list.length = 0
  }

  commandConfig = {}

  build = async () => {}

  preview = async () => {}

  wait = async () => READY
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) => registerStartCommand(program, deps)),
    argv
  )
}

function frames(): unknown[] {
  return stdout.map((line) => JSON.parse(line))
}

function startCommandOf(program: ReturnType<typeof makeProgram>) {
  const start = program.commands.find((command) => command.name() === 'start')

  if (!start) throw new Error('start is not registered')

  return start
}

function startCommand() {
  return startCommandOf(makeProgram(registerStartCommand))
}

// Every spelling commander accepts for start, read from the registered options.
function registeredFlags(): string[] {
  return startCommand().options.flatMap((option) =>
    [option.short, option.long].filter((flag): flag is string => Boolean(flag))
  )
}

function flagsIn(argv: string[]): string[] {
  return argv
    .filter((arg) => arg.startsWith('-'))
    .map((arg) => arg.split('=')[0])
}

// What the build and the launch receive when no flag is typed. A row states
// only the keys its flags change, and both objects are compared whole.
const UNTYPED_BUILD = {
  browser: 'chromium',
  metadataCommand: 'start',
  launchFollows: true,
  polyfill: undefined,
  install: undefined,
  extensions: undefined,
  silent: true
}

const UNTYPED_LAUNCH = {
  profile: undefined,
  browser: 'chromium',
  chromiumBinary: undefined,
  geckoBinary: undefined,
  startingUrl: undefined,
  port: undefined,
  host: undefined,
  noBrowser: false,
  noOpen: undefined,
  extensions: undefined,
  metadataCommand: 'start',
  allowControl: false,
  allowEval: false,
  logLevel: undefined,
  logContexts: undefined,
  logFormat: undefined,
  logTimestamps: undefined,
  logColor: undefined,
  logUrl: undefined,
  logTab: undefined
}

interface ForwardingRow {
  argv: string[]
  env?: Record<string, string>
  config?: unknown
  build?: Record<string, unknown>
  // null when the row launches no browser.
  launch?: Record<string, unknown> | null
}

const NO_LAUNCH = {build: {launchFollows: false}, launch: null}

const FORWARDING: ForwardingRow[] = [
  {argv: []},
  {
    argv: [],
    config: {browser: 'firefox'},
    build: {browser: 'firefox'},
    launch: {browser: 'firefox'}
  },
  {
    argv: ['--browser', 'edge'],
    config: {browser: 'firefox'},
    build: {browser: 'edge'},
    launch: {browser: 'edge'}
  },
  {argv: [], env: {EXTENSION_CLI_NO_BROWSER: '1'}, ...NO_LAUNCH},
  {argv: [], config: {noBrowser: true}, ...NO_LAUNCH},
  {argv: ['--profile', 'false'], launch: {profile: false}},
  {
    argv: ['--profile', '/tmp/my-profile'],
    launch: {profile: '/tmp/my-profile'}
  },
  {argv: ['--polyfill'], build: {polyfill: true}},
  {argv: ['--polyfill', 'false'], build: {polyfill: false}},
  {argv: ['--no-polyfill'], build: {polyfill: false}},
  // The browser phase still runs under --no-open. Only the tab is skipped.
  {argv: ['--no-open'], launch: {noOpen: true}},
  {
    argv: ['--chromium-binary', '/bin/chromium'],
    launch: {chromiumBinary: '/bin/chromium'}
  },
  {argv: ['--gecko-binary', '/bin/gecko'], launch: {geckoBinary: '/bin/gecko'}},
  {
    argv: ['--firefox-binary', '/bin/firefox'],
    launch: {geckoBinary: '/bin/firefox'}
  },
  {
    argv: ['--starting-url', 'https://example.com'],
    launch: {startingUrl: 'https://example.com'}
  },
  {argv: ['--port', '9000'], launch: {port: '9000'}},
  {argv: ['--port', '0'], launch: {port: '0'}},
  {argv: ['--host', '0.0.0.0'], launch: {host: '0.0.0.0'}},
  // Accepted at 4.1.30 and still sent by callers that share their flags with
  // dev. start serves nothing, so the value is taken and never forwarded.
  {argv: ['--public-host', '203.0.113.7']},
  {
    argv: ['--log-context', 'background, CONTENT '],
    launch: {logContexts: ['background', 'content']}
  },
  {argv: ['--log-context', 'all']},
  {argv: ['--logs', 'debug'], launch: {logLevel: 'debug'}},
  // The flag is read in any case, and the engine compares the level exactly.
  {argv: ['--logs', ' OFF '], launch: {logLevel: 'off'}},
  {argv: ['--log-format', 'ndjson'], launch: {logFormat: 'ndjson'}},
  {argv: ['--no-log-timestamps'], launch: {logTimestamps: false}},
  {argv: ['--no-log-color'], launch: {logColor: false}},
  {argv: ['--log-url', '/api/i'], launch: {logUrl: '/api/i'}},
  {argv: ['--log-tab', '12'], launch: {logTab: '12'}},
  {
    argv: ['--extensions', 'a, ,b'],
    build: {extensions: ['a', 'b']},
    launch: {extensions: ['a', 'b']}
  },
  {argv: ['--allow-control'], launch: {allowControl: true}},
  {argv: ['--allow-eval'], launch: {allowControl: true, allowEval: true}},
  {argv: ['--install'], build: {install: true}},
  {argv: ['--install', 'false'], build: {install: false}},
  {argv: ['--wait', 'false']},
  {argv: ['--output', 'json']},
  {argv: ['--output', 'pretty']},
  {argv: ['--wait-format', 'json']},
  {argv: ['--debug']},
  {argv: ['--author']},
  {argv: ['--author-mode']},
  {
    argv: ['--browser', 'chrome'],
    build: {browser: 'chrome'},
    launch: {browser: 'chrome'}
  }
]

describe('extension start flag forwarding', () => {
  it('has a row for every flag the command registers', () => {
    // A flag that is only ever refused alone is typed in the refusal table.
    const typed = new Set(
      [...FORWARDING, ...REFUSALS].flatMap((row) => flagsIn(row.argv))
    )

    expect(registeredFlags().filter((flag) => !typed.has(flag))).toEqual([])
  })

  // It could only fail: start refuses Safari, and the flag is Safari-only.
  it('does not take --enable-extension', async () => {
    const program = makeProgram((root) => registerStartCommand(root, deps))
    const printed: string[] = []

    startCommandOf(program).configureOutput({
      writeErr: (text) => printed.push(text)
    })

    expect(registeredFlags()).not.toContain('--enable-extension')
    await expect(
      runCli(program, ['start', '.', '--enable-extension'])
    ).rejects.toThrow("error: unknown option '--enable-extension'")

    expect(builds).toEqual([])
  })

  it.each(
    FORWARDING
  )('hands the build and the launch the options of start $argv (env $env, config $config)', async (row) => {
    commandConfig = row.config ?? {}

    for (const [name, value] of Object.entries(row.env ?? {})) {
      vi.stubEnv(name, value)
    }

    expect(await run(['start', PROJECT, ...row.argv])).toBe(0)
    expect(builds).toEqual([[PROJECT, {...UNTYPED_BUILD, ...row.build}]])

    if (row.launch === null) {
      expect(previews).toEqual([])
      expect(browserRuns).toEqual([])

      return
    }

    expect(previews).toEqual([[PROJECT, {...UNTYPED_LAUNCH, ...row.launch}]])

    // The runner learns which command launched it, on top of what it was given.
    expect(browserRuns).toEqual([{launched: true, command: 'start'}])
  })

  // The engine never ends the process, so the exit is the command's to own
  // in both output modes and no key may ask the engine for it.
  it.each([
    [[]],
    [['--output', 'json']],
    [['--wait-format', 'json']]
  ])('never asks the engine to end the process for start %j', async (argv) => {
    expect(await run(['start', PROJECT, ...argv])).toBe(0)
    expect(builds[0][1]).not.toHaveProperty('exitOnError')
  })

  it('builds and launches once per browser of a list, in order', async () => {
    expect(await run(['start', '.', '--browser', 'chrome,firefox'])).toBe(0)
    expect(builds.map(([, options]) => options.browser)).toEqual([
      'chrome',
      'firefox'
    ])

    expect(previews.map(([, options]) => options.browser)).toEqual([
      'chrome',
      'firefox'
    ])

    expect(events).toEqual(['build', 'preview', 'build', 'preview'])
  })

  it('reads the project config for the start command before it picks a browser', async () => {
    expect(await run(['start', PROJECT])).toBe(0)
    expect(configReads[0]).toEqual([PROJECT, 'start'])
  })

  it('says what --port and --host bind in start --help', () => {
    const help = startCommand().helpInformation().replace(/\s+/g, ' ')

    expect(help).toContain(
      "--port <port> seed the browser's debugging port, which listens on this value plus 100. Without it the browser listens on 9222"
    )

    expect(help).toContain(
      '--host <host> host the control channel binds to under --allow-control or --allow-eval. Nothing else listens. Defaults to `127.0.0.1`'
    )

    expect(help).not.toContain('development server')
    expect(help).not.toContain('dev server')
  })

  // A typed --no-browser and one from extension.config.js both open no
  // browser, and the control channel rides on the browser.
  it('refuses --allow-control when the config turns the browser off', async () => {
    commandConfig = {noBrowser: true}

    expect(await run(['start', PROJECT, '--allow-control'])).toBe(1)
    expect(stderr).toEqual([CONTROL_NEEDS_BROWSER])
    expect(builds).toEqual([])
  })

  it('lists both control flags in start --help', () => {
    const help = startCommand().helpInformation()

    expect(help).toContain('--allow-control')
    expect(help).toContain('--allow-eval')
  })
})

interface RefusalRow {
  name: string
  argv: string[]
  env?: Record<string, string>
  stderr: string[]
  frame: {status: string; error: {code: string; message: string}}
}

// Safari has its own refusal on this command, so the choices leave it out.
const RUN_ONLY_TARGETS = SUPPORTED_BROWSER_TARGETS.filter(
  (target) => !isEmulatorVendor(target) && !isSafariVendor(target)
).join(', ')

// Same contract as preview: the refusal has to hand the user a command, and
// it has to give the measured reason for having no Safari path.
const SAFARI_REFUSAL =
  "⏵⏵⏵ Error: start can't load an extension into Safari.\n" +
  'Safari loads an extension only from an app it has registered, and that app is enabled by hand once installed.\n' +
  'Its automation route can load a folder but grants no website access, so content scripts never run.\n' +
  'Run a live Safari session: extension dev --browser safari\n' +
  'Or package the app and open it: extension build --browser safari --open\n' +
  'Both need macOS with Xcode, and Safari takes the enable gesture once in Safari ▸ Settings ▸ Extensions.'

const WHOLE_NUMBER_USE = {
  '--wait-timeout': 'Use a whole number of milliseconds, such as 10000.',
  '--port':
    'Use a whole number from 0 to 65535, such as 8080. 0 picks a free port.'
} as const

const CONTROL_NEEDS_BROWSER_TEXT =
  '--no-browser cannot be combined with --allow-control or --allow-eval on start.\n' +
  'The control channel is carried by the browser this command opens, and --no-browser opens none. Drop --no-browser, or drop --allow-control and --allow-eval.'

const CONTROL_NEEDS_BROWSER = `⏵⏵⏵ Error: ${CONTROL_NEEDS_BROWSER_TEXT}`

const REFUSALS: RefusalRow[] = [
  ...[['--allow-control'], ['--allow-eval']].map(
    (argv): RefusalRow => ({
      name: `--no-browser with ${argv[0]}`,
      argv,
      env: {EXTENSION_CLI_NO_BROWSER: '1'},
      stderr: [CONTROL_NEEDS_BROWSER],
      frame: {
        status: 'usage',
        error: {code: 'E_INVALID_OPTION', message: CONTROL_NEEDS_BROWSER_TEXT}
      }
    })
  ),
  ...[
    ['--wait-timeout', '5000'],
    ['--wait', 'false', '--wait-timeout', '5000']
  ].map(
    (argv): RefusalRow => ({
      name: `${argv.join(' ')} with no wait to time`,
      argv,
      stderr: [
        '⏵⏵⏵ Error: --wait-timeout applies only with --wait. Add --wait, or drop --wait-timeout.'
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
      ['--wait-timeout', '10s'],
      ['--wait-timeout', '1.5'],
      ['--port', 'abc'],
      ['--port', '-1'],
      ['--port', '70000']
    ] as const
  ).map(([flag, value]): RefusalRow => {
    const message = `${flag} got "${value}". ${WHOLE_NUMBER_USE[flag]}`

    return {
      name: `${flag} ${value}`,
      argv: [flag, value],
      stderr: [`⏵⏵⏵ Error: ${message}`],
      frame: {status: 'usage', error: {code: 'E_INVALID_OPTION', message}}
    }
  }),
  {
    name: 'a browser name nobody supports',
    argv: ['--browser', 'netscape'],
    stderr: [
      `⏵⏵⏵ Error: Unsupported --browser value: netscape.\nChoose one of: ${RUN_ONLY_TARGETS}.`
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_UNSUPPORTED_BROWSER',
        message: `Unsupported browser: netscape. Choose one of: ${RUN_ONLY_TARGETS}.`
      }
    }
  },
  {
    // Safari is a supported browser that this command has no path for, which
    // is a different failure from an unknown vendor. The codes must not merge.
    name: 'safari, which it has no path for',
    argv: ['--browser', 'safari'],
    stderr: [SAFARI_REFUSAL],
    frame: {
      status: 'usage',
      error: {
        code: 'E_COMMAND_UNSUPPORTED_FOR_TARGET',
        message: 'Safari is not supported by start.'
      }
    }
  },
  {
    // Same process, both flags: --wait never starts a server, so the run used
    // to sit on the ready contract for the whole --wait-timeout and then fail.
    name: '--no-browser with --wait',
    argv: ['--wait'],
    env: {EXTENSION_CLI_NO_BROWSER: '1'},
    stderr: [
      '⏵⏵⏵ Error: --no-browser and --wait cannot run in the same process.\n--no-browser runs the server without a browser, and --wait only reads the ready contract another process writes.\nRUN extension start --no-browser\nTHEN extension start --wait --output json in a second process'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message:
          '--no-browser and --wait cannot run in the same process. Run `extension start --no-browser` in one process and `extension start --wait` in another.'
      }
    }
  }
]

describe.each(REFUSALS)('extension start refuses $name', (row) => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(row.env ?? {})) {
      vi.stubEnv(name, value)
    }
  })

  function expectNothingRan() {
    expect(builds).toEqual([])
    expect(previews).toEqual([])
    expect(browserRuns).toEqual([])
    expect(waitInputs).toEqual([])
  }

  it('on stderr, with exit 1 and nothing run', async () => {
    expect(await run(['start', '.', ...row.argv])).toBe(1)
    expect(stderr).toEqual(row.stderr)
    expect(stdout).toEqual([])
    expectNothingRan()
  })

  it('as one frame and no prose under --output json', async () => {
    expect(await run(['start', '.', ...row.argv, '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'start',
        value: null,
        warnings: [],
        ...row.frame
      }
    ])

    expect(stderr).toEqual([])
    expectNothingRan()
  })
})

describe('extension start', () => {
  it.each([
    '--debug',
    '--author',
    '--author-mode'
  ])('enables maintainer diagnostics with %s', async (flag) => {
    expect(await run(['start', '.', flag])).toBe(0)
    expect(process.env.EXTENSION_DEBUG).toBe('1')
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })

  it('prints no frame and leaves EXTENSION_OUTPUT alone in pretty mode', async () => {
    expect(await run(['start', '.'])).toBe(0)
    expect(builds).toHaveLength(1)
    expect(stdout).toEqual([])
    expect(process.env.EXTENSION_OUTPUT).toBeUndefined()
  })
})

describe('extension start --output json', () => {
  it('emits one startup frame, after the build and the launch', async () => {
    expect(await run(['start', '.', '--output', 'json'])).toBe(0)
    // Same contract as build/preview: develop's previewing banner is a
    // humanLine, and this env is what keeps it off the envelope stream.
    expect(process.env.EXTENSION_OUTPUT).toBe('json')
    // `port` stayed on the frame for readers of the 4.1.30 shape. It was the
    // requested port then and nothing ever listened on it, so it is null now.
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'start',
        status: 'started',
        value: {
          projectPath: '.',
          browser: 'chromium',
          browsers: ['chromium'],
          port: null,
          pid: process.pid,
          noBrowser: false,
          allowControl: false,
          allowEval: false
        },
        error: null,
        warnings: []
      }
    ])

    // The frame says started, so it waits for the build and the launch.
    expect(events).toEqual(['build', 'preview', 'stdout'])
  })

  it('emits a failure frame when the build rejects', async () => {
    build = async () => {
      throw new Error('Build failed with errors')
    }

    expect(await run(['start', '.', '--output', 'json'])).toBe(1)
    // One frame: an ok "started" ahead of it described a run that failed.
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'start',
        status: 'build-failed',
        value: null,
        error: {code: CODES.E_COMPILE, message: 'Build failed with errors'},
        warnings: [],
        hint: 'Fix the error above and run start again.'
      }
    ])

    expect(previews).toEqual([])
    expect(reportFailure.mock.calls).toEqual([
      [{code: CODES.E_COMPILE, exitCode: 1}]
    ])
  })

  it.each([
    [
      'E_MANIFEST_NOT_FOUND',
      'Add a manifest.json at the project root or in src/, or pass the folder that holds it.'
    ],
    [
      'E_MANIFEST_IN_PUBLIC',
      'Move manifest.json out of public/ to the project root or src/. Files in public/ are copied to the output as they are.'
    ]
  ])('frames %s from the build as usage with the way out', async (code, hint) => {
    build = async () => {
      throw Object.assign(new Error('Manifest file not found.'), {code})
    }

    expect(await run(['start', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toMatchObject([{status: 'usage', error: {code}, hint}])
  })

  it('keeps the code the build declared in the frame and the failure row', async () => {
    build = async () => {
      throw Object.assign(new Error('The bundler crashed'), {
        code: CODES.E_COMPILE_FATAL
      })
    }

    expect(await run(['start', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toMatchObject([
      {
        status: 'build-failed',
        error: {code: CODES.E_COMPILE_FATAL, message: 'The bundler crashed'}
      }
    ])

    expect(reportFailure.mock.calls).toEqual([
      [{code: CODES.E_COMPILE_FATAL, exitCode: 1}]
    ])
  })

  // The engine prints the failure before it rejects, so a line from the
  // command here would show the same failure twice.
  it.each([
    [new Error('Build failed with errors'), CODES.E_COMPILE],
    [
      Object.assign(new Error('The bundler crashed'), {
        code: CODES.E_COMPILE_FATAL
      }),
      CODES.E_COMPILE_FATAL
    ]
  ])('exits 1 in pretty mode on %s, prints nothing and launches nothing', async (error, code) => {
    build = async () => {
      throw error
    }

    expect(await run(['start', '.'])).toBe(1)
    expect(stderr).toEqual([])
    expect(stdout).toEqual([])
    expect(previews).toEqual([])
    expect(browserRuns).toEqual([])
    expect(reportFailure.mock.calls).toEqual([[{code, exitCode: 1}]])
  })

  it('prints no ok frame when the launch rejects', async () => {
    preview = async () => {
      throw Object.assign(new Error('the browser never started'), {
        code: CODES.E_BROWSER_LAUNCH
      })
    }

    await expect(run(['start', '.', '--output', 'json'])).rejects.toThrow(
      'the browser never started'
    )

    expect(frames()).toEqual([])
  })
})

describe('extension start --wait', () => {
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
  ])('hands wait mode the input of start %j and builds nothing', async (flags, input) => {
    expect(await run(['start', PROJECT, ...flags])).toBe(0)
    expect(waitInputs).toEqual([
      {
        command: 'start',
        pathOrRemoteUrl: PROJECT,
        browsers: ['chromium'],
        ...input
      }
    ])

    expect(builds).toEqual([])
    expect(previews).toEqual([])
  })

  it.each([
    [['--wait', '--wait-format', 'json']],
    // Wait mode answers pretty here, so only --output can ask for the frame.
    [['--wait', '--output', 'json']]
  ])('prints what wait mode found as one ready frame for %j', async (flags) => {
    wait = async () => ({...READY, format: 'pretty'})

    expect(await run(['start', '.', ...flags])).toBe(0)
    // The pre-envelope wait frame now rides inside value.
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'start',
        status: 'ready',
        value: {
          mode: 'wait',
          command: 'start',
          browsers: ['chromium'],
          results: [{browser: 'chromium', ok: true}]
        },
        error: null,
        warnings: []
      }
    ])
  })

  it('prints nothing on stdout for a pretty wait', async () => {
    expect(await run(['start', '.', '--wait'])).toBe(0)
    expect(stdout).toEqual([])
  })

  it('reports a wait timeout as E_READY_TIMEOUT', async () => {
    wait = async () => {
      throw new WaitModeError('Timed out waiting', CODES.E_READY_TIMEOUT)
    }

    await expect(
      run(['start', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('Timed out')

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'start',
        status: 'timeout',
        value: null,
        error: {code: CODES.E_READY_TIMEOUT, message: 'Timed out waiting'},
        warnings: [],
        hint: 'Raise --wait-timeout, or read the server output for what kept it from reporting ready.'
      }
    ])
  })

  it('frames a locked profile as failed with the hint preview gives', async () => {
    wait = async () => {
      throw new WaitModeError('The profile is in use.', CODES.E_PROFILE_LOCKED)
    }

    await expect(
      run(['start', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('The profile is in use.')

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'start',
        status: 'failed',
        value: null,
        error: {
          code: CODES.E_PROFILE_LOCKED,
          message: 'The profile is in use.'
        },
        warnings: [],
        hint: 'Close the browser that has this profile open, or pass --profile <path> to use another one.'
      }
    ])
  })

  it('falls back to E_INTERNAL for an untagged wait failure', async () => {
    wait = async () => {
      throw new Error('Compilation failed')
    }

    await expect(
      run(['start', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('Compilation failed')

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'start',
        status: 'failed',
        value: null,
        error: {code: CODES.E_INTERNAL, message: 'Compilation failed'},
        warnings: [],
        hint: 'Read the server output for the failure behind the ready contract.'
      }
    ])
  })
})

describe('extension start tells telemetry which browsers it resolved', () => {
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

    await run(['start', PROJECT, ...argv])

    expect(notedBrowsers).toEqual([expected])
  })

  it('tells nothing for a run refused before a browser is resolved', async () => {
    commandConfig = {browser: 'firefox'}

    expect(await run(['start', PROJECT, '--output', 'xml'])).toBe(1)
    expect(notedBrowsers).toEqual([])
    expect(configReads).toEqual([])
  })
})
