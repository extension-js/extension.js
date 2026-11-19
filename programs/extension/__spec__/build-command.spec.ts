import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getBuildSummary} from '../../develop/lib/build-summary'
import {registerBuildCommand} from '../commands/build'
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
const PROJECT = trackTempFolders()('extjs-build-spec-')

type EngineCall = [projectPath: string, options: Record<string, unknown>]
type BuildDeps = NonNullable<Parameters<typeof registerBuildCommand>[1]>
type Preflight = ReturnType<NonNullable<BuildDeps['safariPreflight']>>

const builds: EngineCall[] = []
// The one call that sends a failure row, so a spec can read what would travel.
const reportFailure = vi.fn()
const configReads: unknown[][] = []
const packagerOptions: unknown[] = []
const packaged: unknown[][] = []

const PREFLIGHT_OK = {severity: 'ok', message: ''}

let commandConfig: unknown = {}
let preflight = PREFLIGHT_OK
let build: () => Promise<unknown> = async () => undefined

// What the command told telemetry about the browsers of the run.
const notedBrowsers: string[][] = []

const deps: BuildDeps = {
  noteBrowsers: (resolved) => {
    notedBrowsers.push([...resolved])
  },
  loadDevelop: async () =>
    developStandIn({
      extensionBuild: async (...call: EngineCall) => {
        builds.push(call)

        return build()
      },
      loadCommandConfig: async (...args: unknown[]) => {
        configReads.push(args)

        return commandConfig
      }
    }),
  safariPreflight: () => preflight as Preflight,
  // The real packager drives Xcode, so the factory records what build asked of it.
  createPackager: ((options: unknown) => {
    packagerOptions.push(options)

    return async (...args: unknown[]) => {
      packaged.push(args)
    }
  }) as never,
  reportFailure
}

let stdout: string[]
let stderr: string[]
let warned: string[]

beforeEach(() => {
  stdout = []
  stderr = []
  warned = []
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation((line) => {
    stdout.push(String(line))
  })

  vi.spyOn(console, 'error').mockImplementation((line) => {
    stderr.push(String(line))
  })

  vi.spyOn(console, 'warn').mockImplementation((line) => {
    warned.push(String(line))
  })

  stubCommandEnv()
})

afterEach(() => {
  notedBrowsers.length = 0
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  reportFailure.mockClear()

  for (const list of [builds, configReads, packagerOptions, packaged]) {
    list.length = 0
  }

  commandConfig = {}
  preflight = PREFLIGHT_OK
  build = async () => undefined
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) => registerBuildCommand(program, deps)),
    argv
  )
}

function frames(): any[] {
  return stdout.map((line) => JSON.parse(line))
}

// Every spelling commander accepts for build, read from the registered options.
function registeredFlags(): string[] {
  const command = makeProgram(registerBuildCommand).commands.find(
    (candidate) => candidate.name() === 'build'
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

// What extensionBuild receives when no flag is typed, so the project config
// decides. A row states only the keys its flags change.
const UNTYPED = {
  browser: 'chromium',
  polyfill: undefined,
  zip: undefined,
  zipSource: undefined,
  zipFilename: undefined,
  zipDir: undefined,
  sourceMaps: undefined,
  outDir: undefined,
  silent: undefined,
  addonLint: undefined,
  minify: undefined,
  install: undefined,
  extensions: undefined,
  mode: undefined,
  appName: undefined,
  bundleId: undefined,
  developmentTeam: undefined,
  macOsOnly: undefined,
  appIcon: undefined,
  forceRegenerate: undefined,
  safariPackager: expect.any(Function)
}

interface ForwardingRow {
  argv: string[]
  config?: unknown
  options: Record<string, unknown>
}

const SAFARI = ['--browser', 'safari']

const FORWARDING: ForwardingRow[] = [
  {argv: [], options: {}},
  {argv: [], config: {browser: 'firefox'}, options: {browser: 'firefox'}},
  {
    argv: ['--browser', 'edge'],
    config: {browser: 'firefox'},
    options: {browser: 'edge'}
  },
  {argv: ['--polyfill'], options: {polyfill: true}},
  {argv: ['--polyfill', 'false'], options: {polyfill: false}},
  {argv: ['--no-polyfill'], options: {polyfill: false}},
  {argv: ['--zip'], options: {zip: true}},
  {argv: ['--zip', 'false'], options: {zip: false}},
  {argv: ['--zip-source'], options: {zipSource: true}},
  {argv: ['--zip-filename', 'release'], options: {zipFilename: 'release'}},
  {argv: ['--zip-dir', 'release'], options: {zipDir: 'release'}},
  {argv: ['--source-maps'], options: {sourceMaps: true}},
  {argv: ['--source-maps', 'false'], options: {sourceMaps: false}},
  {argv: ['--out-dir', 'build'], options: {outDir: 'build'}},
  {argv: ['--silent'], options: {silent: true}},
  {argv: ['--addon-lint'], options: {addonLint: true}},
  {argv: ['--no-addon-lint'], options: {addonLint: false}},
  {argv: ['--minify'], options: {minify: true}},
  {argv: ['--no-minify'], options: {minify: false}},
  {argv: ['--install'], options: {install: true}},
  {argv: ['--install', 'false'], options: {install: false}},
  {argv: ['--extensions', 'a, ,b'], options: {extensions: ['a', 'b']}},
  {argv: ['--mode', 'development'], options: {mode: 'development'}},
  {argv: ['--mode', ' NONE '], options: {mode: 'none'}},
  // Whether the app opens is the packager's to carry, not the engine's.
  {argv: [...SAFARI, '--open'], options: {browser: 'safari'}},
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
  {argv: SAFARI, options: {browser: 'safari'}},
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
  {argv: ['--output', 'json'], options: {}},
  {argv: ['--output', 'pretty'], options: {}},
  {argv: ['--debug'], options: {}},
  {argv: ['--author'], options: {}},
  {argv: ['--author-mode'], options: {}}
]

describe('extension build flag forwarding', () => {
  it('has a row for every flag the command registers', () => {
    const typed = new Set(FORWARDING.flatMap((row) => flagsIn(row.argv)))

    expect(registeredFlags().filter((flag) => !typed.has(flag))).toEqual([])
  })

  it.each(
    FORWARDING
  )('hands extensionBuild the options of build $argv (config $config)', async ({
    argv,
    config = {},
    options
  }) => {
    commandConfig = config

    expect(await run(['build', PROJECT, ...argv])).toBe(0)
    expect(builds).toEqual([[PROJECT, {...UNTYPED, ...options}]])
  })

  // The engine never ends the process, so the exit is the command's to own
  // in both output modes and no key may ask the engine for it.
  it.each([
    [[]],
    [['--output', 'json']]
  ])('never asks the engine to end the process for build %j', async (argv) => {
    expect(await run(['build', PROJECT, ...argv])).toBe(0)
    expect(builds[0][1]).not.toHaveProperty('exitOnError')
  })

  it('builds once per browser of a list, in order', async () => {
    expect(await run(['build', '.', '--browser', 'chrome,firefox'])).toBe(0)
    expect(builds.map(([, options]) => options.browser)).toEqual([
      'chrome',
      'firefox'
    ])
  })

  it('reads the project config for the build command before it picks a browser', async () => {
    expect(await run(['build', PROJECT])).toBe(0)
    expect(configReads[0]).toEqual([PROJECT, 'build'])
  })
})

interface RefusalRow {
  name: string
  argv: string[]
  config?: unknown
  preflight?: {severity: string; message: string}
  stderr: string[]
  frame: {status: string; error: {code: string; message: string}}
}

const EVERY_TARGET = SUPPORTED_BROWSER_TARGETS.join(', ')

const REFUSALS: RefusalRow[] = [
  {
    // The frame names every valid choice, so a machine reader is not left
    // with a bare "unsupported" and json mode needs no prose.
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
    name: 'an unsupported browser name coming from the config',
    argv: [],
    config: {browser: 'nope'},
    stderr: [
      `⏵⏵⏵ Unsupported --browser value: nope.\nChoose one of: ${EVERY_TARGET}.`
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_UNSUPPORTED_BROWSER',
        message: `Unsupported browser: nope. Choose one of: ${EVERY_TARGET}.`
      }
    }
  },
  {
    name: 'a --mode it does not know',
    argv: ['--mode', 'fastest'],
    stderr: ['⏵⏵⏵ --mode got "fastest". Use development, production or none.'],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message: '--mode got "fastest". Use development, production or none.'
      }
    }
  },
  {
    name: 'a safari-only flag on a chromium target',
    argv: ['--app-name', 'My App'],
    stderr: [
      '⏵⏵⏵ --app-name only applies to Safari targets.\nAdd --browser safari (or webkit-based).'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message: '--app-name applies to safari targets only.'
      }
    }
  },
  {
    name: 'several safari-only flags on a chromium target',
    argv: ['--open', '--force-regenerate'],
    stderr: [
      '⏵⏵⏵ --open, --force-regenerate only apply to Safari targets.\nAdd --browser safari (or webkit-based).'
    ],
    frame: {
      status: 'usage',
      error: {
        code: 'E_INVALID_OPTION',
        message: '--open, --force-regenerate apply to safari targets only.'
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
    name: 'a safari toolchain the preflight calls fatal',
    argv: ['--browser', 'safari'],
    preflight: {severity: 'fatal', message: 'xcode is broken'},
    stderr: ['xcode is broken'],
    frame: {
      status: 'failed',
      error: {code: 'E_SAFARI_TOOLCHAIN', message: 'xcode is broken'}
    }
  }
]

describe.each(REFUSALS)('extension build refuses $name', (row) => {
  beforeEach(() => {
    commandConfig = row.config ?? {}
    preflight = row.preflight ?? PREFLIGHT_OK
  })

  it('on stderr, with exit 1 and nothing built', async () => {
    expect(await run(['build', '.', ...row.argv])).toBe(1)
    expect(stderr).toEqual(row.stderr)
    expect(stdout).toEqual([])
    expect(builds).toEqual([])
  })

  it('as one frame under --output json', async () => {
    expect(await run(['build', '.', ...row.argv, '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'build',
        value: null,
        warnings: [],
        ...row.frame
      }
    ])

    expect(stderr).toEqual([])
    expect(builds).toEqual([])
  })
})

interface RejectionRow {
  name: string
  error: unknown
  code: string
}

const REJECTIONS: RejectionRow[] = [
  {
    name: 'a compile failure that names no code',
    error: new Error('Build failed with errors'),
    code: 'E_COMPILE'
  },
  {
    name: 'an archive that was asked for and not written',
    error: Object.assign(new Error('The distribution zip was not created'), {
      code: 'E_ZIP_SKIPPED'
    }),
    code: 'E_ZIP_SKIPPED'
  },
  {
    name: 'an output folder the build refuses to replace',
    error: Object.assign(new Error('--out-dir points at the project root'), {
      code: 'E_INVALID_OPTION'
    }),
    code: 'E_INVALID_OPTION'
  }
]

describe.each(
  REJECTIONS
)('extension build when the engine rejects with $name', ({error, code}) => {
  beforeEach(() => {
    build = async () => {
      throw error
    }
  })

  // The engine prints the failure before it rejects, so a line from the
  // command here would show the same failure twice.
  it('exits 1 in pretty mode and prints nothing of its own', async () => {
    expect(await run(['build', '.'])).toBe(1)
    expect(stderr).toEqual([])
    expect(stdout).toEqual([])
    expect(warned).toEqual([])
    expect(reportFailure.mock.calls).toEqual([[{code, exitCode: 1}]])
  })

  it('exits 1 with one frame under --output json', async () => {
    expect(await run(['build', '.', '--output', 'json'])).toBe(1)
    expect(frames().map((frame) => [frame.status, frame.error.code])).toEqual([
      ['build-failed', code]
    ])

    expect(stderr).toEqual([])
    expect(reportFailure.mock.calls).toEqual([[{code, exitCode: 1}]])
  })

  it('stops at the first browser of a list that fails', async () => {
    expect(await run(['build', '.', '--browser', 'chrome,firefox'])).toBe(1)
    expect(builds.map(([, options]) => options.browser)).toEqual(['chrome'])
    expect(reportFailure).toHaveBeenCalledTimes(1)
  })
})

describe('extension build', () => {
  it.each([
    '--debug',
    '--author',
    '--author-mode'
  ])('enables maintainer diagnostics with %s', async (flag) => {
    expect(await run(['build', '.', flag])).toBe(0)
    expect(process.env.EXTENSION_DEBUG).toBe('1')
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })

  it('sets EXTENSION_OUTPUT to json before the build runs', async () => {
    let seen: string | undefined = 'never built'

    build = async () => {
      seen = process.env.EXTENSION_OUTPUT
    }

    expect(await run(['build', '.', '--output', 'json'])).toBe(0)
    expect(seen).toBe('json')
  })

  it('prints no frame and leaves EXTENSION_OUTPUT alone in pretty mode', async () => {
    expect(await run(['build', '.'])).toBe(0)
    expect(builds).toHaveLength(1)
    expect(stdout).toEqual([])
    expect(process.env.EXTENSION_OUTPUT).toBeUndefined()
  })

  it('warns and builds without a packager on a skip preflight', async () => {
    preflight = {severity: 'skip', message: 'not macOS'}

    expect(await run(['build', '.', '--browser', 'safari'])).toBe(0)
    expect(warned).toEqual(['not macOS'])
    expect(builds).toEqual([
      ['.', {...UNTYPED, browser: 'safari', safariPackager: undefined}]
    ])

    expect(packagerOptions).toEqual([])
  })

  // build is a packaging command: the app opens only when --open asks.
  it.each([
    [['--browser', 'safari'], true],
    [['--browser', 'safari', '--open'], false],
    [['--browser', 'safari', '--open', 'false'], true]
  ])('wires a safari packager for %j whose noOpen is %s', async (flags, noOpen) => {
    expect(await run(['build', '.', ...flags])).toBe(0)

    const packager = builds[0][1].safariPackager as (
      distPath: string,
      mode: string
    ) => Promise<void>
    await packager('/tmp/dist/safari', 'full')

    expect(packagerOptions).toEqual([{browser: 'safari', noOpen}])
    expect(packaged).toEqual([['/tmp/dist/safari', 'full']])
  })

  it('carries the build summary in the --output json envelope', async () => {
    const summary = {
      browser: 'chromium',
      output_path: '/tmp/project/dist/chromium',
      total_assets: 3,
      total_bytes: 2048,
      largest_asset_bytes: 1024,
      warnings_count: 3,
      errors_count: 0,
      warnings: [
        'a warning',
        'W_PERF_BUDGET: a coded warning',
        'E_CONFIG_LOAD: not a warning'
      ]
    }

    build = async () => summary

    expect(await run(['build', '.', '--output', 'json'])).toBe(0)
    // A warning that opens with a declared code also rides the frame's own
    // warnings array, which is where a consumer reads what the run got past.
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'build',
        status: 'built',
        value: {
          projectPath: '.',
          browsers: ['chromium'],
          mode: 'production',
          summaries: [summary]
        },
        error: null,
        warnings: ['W_PERF_BUDGET: a coded warning']
      }
    ])
  })

  it('carries the coded warnings of a failed build in the failure frame', async () => {
    const coded = 'E_CONFIG_LOAD: a coded warning'
    const perf = 'E_PERF_BUDGET: an asset over budget'
    let call = 0

    // The first browser builds with a warning, the second fails carrying it
    // again plus its own, so the frame lists each coded line once.
    build = async () => {
      call += 1

      if (call === 1) return {browser: 'chrome', warnings: [coded]}

      throw Object.assign(new Error('Build failed with errors'), {
        code: 'E_COMPILE',
        warnings: [coded, 'a plain warning', perf, perf]
      })
    }

    expect(
      await run([
        'build',
        '.',
        '--browser',
        'chrome,firefox',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'build',
        status: 'build-failed',
        value: null,
        error: {code: 'E_COMPILE', message: 'Build failed with errors'},
        hint: 'Fix the error above and run build again.',
        warnings: [coded, perf]
      }
    ])
  })

  it('gives a failure frame an empty warnings array when none were carried', async () => {
    build = async () => {
      throw new Error('Build failed with errors')
    }

    expect(await run(['build', '.', '--output', 'json'])).toBe(1)
    expect(frames().map((frame) => frame.warnings)).toEqual([[]])
  })

  // The golden envelope is what a host reads to learn the build frame's shape
  // without running a build. It shipped documenting `{projectPath, browsers,
  // mode}` long after `summaries` joined `value`, so a reader was told the
  // summary channel does not exist.
  describe('the golden build envelope documents the real frame', () => {
    const golden = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'contract', 'golden.build.built.json'),
        'utf8'
      )
    )

    async function emitJsonFrame(argv: string[]) {
      build = async () => ({
        browser: 'chromium',
        output_path: '/home/dev/my-extension/dist/chromium',
        total_assets: 12,
        total_bytes: 248320,
        largest_asset_bytes: 131072,
        warnings_count: 1,
        errors_count: 0,
        warnings: ['Asset size exceeds the recommended limit (128 KiB).']
      })

      expect(await run(argv)).toBe(0)

      return frames().at(-1)
    }

    it('names every key the command actually puts in value', async () => {
      const frame = await emitJsonFrame([
        'build',
        '.',
        '--mode',
        'production',
        '--output',
        'json'
      ])

      expect(
        Object.keys(golden).sort(),
        'the golden envelope names keys the build frame does not, or misses some'
      ).toEqual(Object.keys(frame).sort())

      expect(
        Object.keys(golden.value).sort(),
        'the golden value under-documents what `build --output json` emits'
      ).toEqual(Object.keys(frame.value).sort())

      expect(golden.command).toBe(frame.command)
      expect(golden.status).toBe(frame.status)
      expect(golden.value.mode).toBe(frame.value.mode)
      // Build warnings ride inside the summary, never the envelope's own
      // warnings array. A golden that omitted summaries hid that entirely.
      expect(golden.warnings).toEqual([])
      expect(golden.value.summaries[0].warnings.length).toBeGreaterThan(0)
    })

    it('emits the resolved mode on the default invocation', async () => {
      const frame = await emitJsonFrame(['build', '.', '--output', 'json'])
      expect(frame.value.mode).toBe('production')
      expect(Object.keys(golden.value).sort()).toEqual(
        Object.keys(frame.value).sort()
      )
    })

    it('echoes an explicit --mode override in the frame', async () => {
      const frame = await emitJsonFrame([
        'build',
        '.',
        '--mode',
        'development',
        '--output',
        'json'
      ])
      expect(frame.value.mode).toBe('development')
    })

    it('spells its summary with the fields getBuildSummary emits', () => {
      // Pinned against the produced object rather than the type, so a renamed
      // field fails here instead of quietly aging the golden out of date.
      const real = getBuildSummary(
        'chromium',
        {
          assets: [{size: 131072}, {size: 117248}],
          warnings: [{message: 'a warning'}],
          errors: []
        },
        '/home/dev/my-extension/dist/chromium'
      )
      expect(Object.keys(golden.value.summaries[0]).sort()).toEqual(
        Object.keys(real).sort()
      )
    })
  })
})

describe('extension build tells telemetry which browsers it resolved', () => {
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

    await run(['build', PROJECT, ...argv])

    expect(notedBrowsers).toEqual([expected])
  })

  it('tells nothing for a run refused before a browser is resolved', async () => {
    commandConfig = {browser: 'firefox'}

    expect(await run(['build', PROJECT, '--output', 'xml'])).toBe(1)
    expect(notedBrowsers).toEqual([])
    expect(configReads).toEqual([])
  })
})
