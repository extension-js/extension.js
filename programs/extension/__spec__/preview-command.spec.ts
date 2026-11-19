import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  PREVIEW_NOT_FOUND_NEEDLES,
  registerPreviewCommand
} from '../commands/preview'
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
const PROJECT = trackTempFolders()('extjs-preview-spec-')

type EngineCall = [projectPath: string, options: Record<string, unknown>]
type PreviewDeps = NonNullable<Parameters<typeof registerPreviewCommand>[1]>

const previews: EngineCall[] = []
const browserRuns: unknown[] = []
const configReads: unknown[][] = []

let commandConfig: unknown = {}
let preview: () => Promise<unknown> = async () => undefined

// What the command told telemetry about the browsers of the run.
const notedBrowsers: string[][] = []

const deps: PreviewDeps = {
  noteBrowsers: (resolved) => {
    notedBrowsers.push([...resolved])
  },
  loadDevelop: async () =>
    developStandIn({
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
        previews.push([projectPath, options])
        const result = await preview()
        await runBrowser({launched: true})

        return result
      }
    }),
  runBrowser: (async (launch: unknown) => {
    browserRuns.push(launch)
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
  for (const list of [previews, browserRuns, configReads]) list.length = 0
  commandConfig = {}
  preview = async () => undefined
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) => registerPreviewCommand(program, deps)),
    argv
  )
}

function frames(): unknown[] {
  return stdout.map((line) => JSON.parse(line))
}

// Every spelling commander accepts for preview, read from the registered options.
function registeredFlags(): string[] {
  const command = makeProgram(registerPreviewCommand).commands.find(
    (candidate) => candidate.name() === 'preview'
  )

  return (command?.options ?? []).flatMap((option) =>
    [option.short, option.long].filter((flag): flag is string => Boolean(flag))
  )
}

function flagsIn(argv: string[]): string[] {
  return argv
    .filter((arg) => arg.startsWith('-'))
    .map((arg) => arg.split('=')[0])
}

// What extensionPreview receives when no flag is typed. A row states only the
// keys its flags change, and the whole object is compared.
const UNTYPED = {
  mode: 'production',
  profile: undefined,
  browser: 'chromium',
  chromiumBinary: undefined,
  geckoBinary: undefined,
  noOpen: undefined,
  startingUrl: undefined,
  port: undefined,
  noBrowser: false,
  extensions: undefined,
  outputPath: undefined,
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
  options: Record<string, unknown>
}

const FORWARDING: ForwardingRow[] = [
  {argv: [], options: {}},
  {argv: [], config: {browser: 'firefox'}, options: {browser: 'firefox'}},
  {
    argv: ['--browser', 'edge'],
    config: {browser: 'firefox'},
    options: {browser: 'edge'}
  },
  {
    argv: [],
    env: {EXTENSION_CLI_NO_BROWSER: '1'},
    options: {noBrowser: true}
  },
  {argv: [], config: {noBrowser: true}, options: {noBrowser: true}},
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
    options: {geckoBinary: '/bin/firefox'}
  },
  // --no-open still launches the browser. Only the tab is skipped, so
  // noBrowser stays false and noOpen carries the decision.
  {argv: ['--no-open'], options: {noOpen: true}},
  {
    argv: ['--starting-url', 'https://example.com'],
    options: {startingUrl: 'https://example.com'}
  },
  {argv: ['--port', '9000'], options: {port: '9000'}},
  {argv: ['--port', '0'], options: {port: '0'}},
  {
    argv: ['--log-context', 'background, nope ,content'],
    options: {logContexts: ['background', 'content']}
  },
  {argv: ['--log-context', 'all'], options: {}},
  {argv: ['--logs', 'debug'], options: {logLevel: 'debug'}},
  // The flag is read in any case, and the engine compares the level exactly.
  {argv: ['--logs', ' OFF '], options: {logLevel: 'off'}},
  {argv: ['--log-format', 'ndjson'], options: {logFormat: 'ndjson'}},
  {argv: ['--no-log-timestamps'], options: {logTimestamps: false}},
  {argv: ['--no-log-color'], options: {logColor: false}},
  {argv: ['--log-url', '/api/i'], options: {logUrl: '/api/i'}},
  {argv: ['--log-tab', '12'], options: {logTab: '12'}},
  {argv: ['--extensions', 'a, ,b'], options: {extensions: ['a', 'b']}},
  {argv: ['--allow-control'], options: {allowControl: true}},
  {argv: ['--allow-eval'], options: {allowControl: true, allowEval: true}},
  {
    argv: ['--output-path', '/tmp/unpacked'],
    options: {outputPath: '/tmp/unpacked'}
  },
  {argv: ['--output', 'json'], options: {}},
  {argv: ['--output', 'pretty'], options: {}},
  {argv: ['--debug'], options: {}},
  {argv: ['--author'], options: {}},
  {argv: ['--author-mode'], options: {}}
]

describe('extension preview flag forwarding', () => {
  it('has a row for every flag the command registers', () => {
    const typed = new Set(FORWARDING.flatMap((row) => flagsIn(row.argv)))

    expect(registeredFlags().filter((flag) => !typed.has(flag))).toEqual([])
  })

  it.each(
    FORWARDING
  )('hands extensionPreview the options of preview $argv (env $env, config $config)', async ({
    argv,
    env = {},
    config = {},
    options
  }) => {
    commandConfig = config
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

    expect(await run(['preview', PROJECT, ...argv])).toBe(0)
    expect(previews).toEqual([[PROJECT, {...UNTYPED, ...options}]])
    // The runner gets what the engine hands it, with nothing added.
    expect(browserRuns).toEqual([{launched: true}])
  })

  it('previews once per browser of a list, in order', async () => {
    expect(await run(['preview', '.', '--browser', 'chrome,firefox'])).toBe(0)
    expect(previews.map(([, options]) => options.browser)).toEqual([
      'chrome',
      'firefox'
    ])
  })

  it('reads the project config for the preview command before it picks a browser', async () => {
    expect(await run(['preview', PROJECT])).toBe(0)
    expect(configReads[0]).toEqual([PROJECT, 'preview'])
  })

  // preview never starts the dev server, so nothing reads a connectable host.
  // An advertised key that reaches nothing teaches the wrong lesson.
  it('does not advertise --public-host, which preview never dials', async () => {
    const program = makeProgram(registerPreviewCommand)
    const command = program.commands.find((cmd) => cmd.name() === 'preview')

    expect(registeredFlags()).not.toContain('--public-host')

    // Commander prints the refusal itself, so it is read here, not on stderr.
    const printed: string[] = []
    command?.configureOutput({writeErr: (text) => printed.push(text)})

    await expect(
      runCli(program, ['preview', '.', '--public-host', '203.0.113.7'])
    ).rejects.toThrow("error: unknown option '--public-host'")

    expect(printed.join('')).toContain("error: unknown option '--public-host'")
  })
})

interface RefusalRow {
  name: string
  argv: string[]
  stderr: string[]
  frame: {status: string; error: {code: string; message: string}}
}

// Safari has its own refusal on this command, so the choices leave it out.
const RUN_ONLY_TARGETS = SUPPORTED_BROWSER_TARGETS.filter(
  (target) => !isEmulatorVendor(target) && !isSafariVendor(target)
).join(', ')

// A refusal that names no next command leaves a Safari user stuck, so the
// copy is pinned to the two Safari paths that work, and to the reason.
const SAFARI_REFUSAL =
  "⏵⏵⏵ Error: preview can't load an extension into Safari.\n" +
  'Safari loads an extension only from an app it has registered, and that app is enabled by hand once installed.\n' +
  'Its automation route can load a folder but grants no website access, so content scripts never run.\n' +
  'Run a live Safari session: extension dev --browser safari\n' +
  'Or package the app and open it: extension build --browser safari --open\n' +
  'Both need macOS with Xcode, and Safari takes the enable gesture once in Safari ▸ Settings ▸ Extensions.'

const PORT_USE =
  'Use a whole number from 0 to 65535, such as 8080. 0 picks a free port.'

const REFUSALS: RefusalRow[] = [
  ...['abc', '1.5', '-1', '70000'].map((value): RefusalRow => {
    const message = `--port got "${value}". ${PORT_USE}`

    return {
      name: `--port ${value}`,
      argv: ['--port', value],
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
        message: 'Safari is not supported by preview.'
      }
    }
  }
]

describe.each(REFUSALS)('extension preview refuses $name', (row) => {
  function expectNothingRan() {
    expect(previews).toEqual([])
    expect(browserRuns).toEqual([])
  }

  it('on stderr, with exit 1 and nothing run', async () => {
    expect(await run(['preview', '.', ...row.argv])).toBe(1)
    expect(stderr).toEqual(row.stderr)
    expect(stdout).toEqual([])
    expectNothingRan()
  })

  it('as one frame and no prose under --output json', async () => {
    expect(await run(['preview', '.', ...row.argv, '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'preview',
        value: null,
        warnings: [],
        ...row.frame
      }
    ])

    expect(stderr).toEqual([])
    expectNothingRan()
  })
})

describe('extension preview', () => {
  it('prints no frame and leaves EXTENSION_OUTPUT alone in pretty mode', async () => {
    expect(await run(['preview', PROJECT])).toBe(0)
    expect(previews).toHaveLength(1)
    expect(stdout).toEqual([])
    expect(process.env.EXTENSION_OUTPUT).toBeUndefined()
  })

  it('turns on light mode for remote extension urls', async () => {
    expect(await run(['preview', 'https://example.com/ext.zip'])).toBe(0)
    expect(process.env.EXTJS_LIGHT).toBe('1')
  })

  it('leaves light mode off for a local path', async () => {
    expect(await run(['preview', PROJECT])).toBe(0)
    expect(process.env.EXTJS_LIGHT).toBeUndefined()
  })

  it.each([
    '--debug',
    '--author',
    '--author-mode'
  ])('enables maintainer diagnostics with %s', async (flag) => {
    expect(await run(['preview', '.', flag])).toBe(0)
    expect(process.env.EXTENSION_DEBUG).toBe('1')
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })
})

describe('extension preview --output json', () => {
  it('emits a schema-1 envelope', async () => {
    expect(await run(['preview', '.', '--output', 'json'])).toBe(0)
    // Develop prints the previewing banner through humanLine; this env is
    // what keeps that prose off stdout so the envelope stays one document.
    expect(process.env.EXTENSION_OUTPUT).toBe('json')
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'preview',
        status: 'ready',
        value: {projectPath: '.', browsers: ['chromium']},
        error: null,
        warnings: []
      }
    ])
  })

  it('carries each warning the engine returns once, across browsers', async () => {
    preview = async () => ({warnings: ['a warning', 'a warning']})

    expect(
      await run([
        'preview',
        '.',
        '--browser',
        'chrome,firefox',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'preview',
        status: 'ready',
        value: {projectPath: '.', browsers: ['chrome', 'firefox']},
        error: null,
        warnings: ['a warning']
      }
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
  ])('frames %s as usage with the way out', async (code, hint) => {
    preview = async () => {
      throw Object.assign(new Error('Manifest file not found.'), {code})
    }

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toMatchObject([{status: 'usage', error: {code}, hint}])
  })

  // Both needles are matched against real producer copy, so a rewrite of either
  // message fails here rather than silently downgrading to E_INTERNAL.
  it('pins the not-found needles against the real producers', async () => {
    const developMessages = await import('../../develop/lib/messages')
    expect(developMessages.manifestNotFoundError('/p/manifest.json')).toContain(
      PREVIEW_NOT_FOUND_NEEDLES[1]
    )

    expect(
      developMessages.previewHasNothingToRun('/p/dist/chrome/manifest.json')
    ).toContain(PREVIEW_NOT_FOUND_NEEDLES[0])
  })

  it.each(
    PREVIEW_NOT_FOUND_NEEDLES
  )('maps %j to E_PREVIEW_NO_DIST', async (needle) => {
    preview = async () => {
      throw new Error(`${needle} …`)
    }

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'preview',
        status: 'not-found',
        value: null,
        error: {code: 'E_PREVIEW_NO_DIST', message: `${needle} …`},
        warnings: [],
        hint: 'Run `extension build` before previewing.'
      }
    ])
  })

  // The launcher codes the refusal it throws, so no message text is matched.
  it('emits load-refused and its code for a load the browser refused', async () => {
    preview = async () => {
      throw Object.assign(
        new Error(
          'Chrome refuses to load this extension, so nothing in it runs.'
        ),
        {code: 'E_EXTENSION_LOAD_REFUSED'}
      )
    }

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'preview',
        status: 'load-refused',
        value: null,
        error: {
          code: 'E_EXTENSION_LOAD_REFUSED',
          message:
            'Chrome refuses to load this extension, so nothing in it runs.'
        },
        warnings: [],
        hint: 'Fix what the browser names, then run the command again.'
      }
    ])
  })

  it('emits E_INTERNAL for any other preview failure', async () => {
    preview = async () => {
      throw new Error('launcher exploded')
    }

    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'preview',
        status: 'failed',
        value: null,
        error: {code: 'E_INTERNAL', message: 'launcher exploded'},
        warnings: []
      }
    ])
  })
})

describe('extension preview tells telemetry which browsers it resolved', () => {
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

    await run(['preview', PROJECT, ...argv])

    expect(notedBrowsers).toEqual([expected])
  })

  it('tells nothing for a run refused before a browser is resolved', async () => {
    commandConfig = {browser: 'firefox'}

    expect(await run(['preview', PROJECT, '--output', 'xml'])).toBe(1)
    expect(notedBrowsers).toEqual([])
    expect(configReads).toEqual([])
  })
})
