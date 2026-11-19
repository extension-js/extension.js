import fs from 'node:fs'
import * as path from 'node:path'
import {Command} from 'commander'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {type BuildOptions, registerBuildCommand} from '../commands/build'
import {type DevOptions, registerDevCommand} from '../commands/dev'
import {type PreviewOptions, registerPreviewCommand} from '../commands/preview'
import {registerStartCommand, type StartOptions} from '../commands/start'
import {declaredChoices} from '../helpers/choice-flags'
import {LOG_CONTEXTS} from '../helpers/log-contexts'
import {missingProjectFolder} from '../helpers/project-folder'
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

const makeTempFolder = trackTempFolders()

const extensionBuild = vi.fn(async (_path: string, _options: unknown) => {})
const extensionDev = vi.fn(async (_path: string, _options: unknown) => {})
const extensionPreview = vi.fn(async (_path: string, _options: unknown) => {})
const loadCommandConfig = vi.fn(async () => ({}))
const waitForReady = vi.fn(async () => {
  throw new Error('this spec never waits')
})
const reportFailure = vi.fn()

const loadDevelop = async () =>
  developStandIn({
    extensionBuild,
    extensionDev,
    loadCommandConfig
  })
const loadPreview = async () => previewStandIn({extensionPreview})

let logSpy: MockInstance<typeof console.log>
let errorSpy: MockInstance<typeof console.error>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  stubCommandEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Every collaborator is a fake, so no command here builds, serves or launches.
function run(argv: string[]) {
  return runCli(
    makeProgram((program) => {
      registerBuildCommand(program, {
        loadDevelop,
        safariPreflight: () => ({severity: 'ok', message: ''}) as never
      })

      registerDevCommand(program, {
        loadDevelop,
        launcher: (async () => {}) as never,
        safariPreflight: () => null,
        armParentWatchdog: (() => () => {}) as never,
        waitForReady: waitForReady as never,
        reportFailure
      })

      registerStartCommand(program, {
        loadDevelop,
        loadPreview,
        runBrowser: (async () => {}) as never,
        waitForReady: waitForReady as never
      })

      registerPreviewCommand(program, {
        loadDevelop,
        loadPreview,
        runBrowser: (async () => {}) as never
      })
    }),
    argv
  )
}

function frames(): unknown[] {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

function stderrLines(): string[] {
  return errorSpy.mock.calls.map((call) => String(call[0]))
}

function engineCalls(): number {
  return (
    extensionBuild.mock.calls.length +
    extensionDev.mock.calls.length +
    extensionPreview.mock.calls.length +
    loadCommandConfig.mock.calls.length
  )
}

const COMMANDS = ['build', 'dev', 'start', 'preview'] as const

describe.each(COMMANDS)('an output flag %s cannot read', (command) => {
  it.each([
    [['--output', 'jsno'], '--output got "jsno". Use pretty or json.'],
    [['--output='], '--output got "". Use pretty or json.'],
    [['--output', 'ndjson'], '--output got "ndjson". Use pretty or json.']
  ])('refuses %j on stderr with nothing on stdout', async (flags, message) => {
    expect(await run([command, '.', ...flags])).toBe(1)
    expect(stderrLines()).toEqual([`⏵⏵⏵ Error: ${message}`])
    expect(logSpy).not.toHaveBeenCalled()
    expect(engineCalls()).toBe(0)
  })

  it.each([
    ' JSON ',
    'Pretty'
  ])('still reads %j, as case and space never mattered', async (value) => {
    expect(await run([command, '.', '--output', value])).toBe(0)
    expect(stderrLines()).toEqual([])
  })
})

describe.each([
  'dev',
  'start'
] as const)('the deprecated --wait-format on %s', (command) => {
  it('is refused with a value it cannot read, even beside a valid --output', async () => {
    expect(
      await run([command, '.', '--output', 'json', '--wait-format', 'nope'])
    ).toBe(1)

    expect(stderrLines()).toEqual([
      '⏵⏵⏵ Error: --wait-format got "nope". Use pretty or json.'
    ])

    expect(logSpy).not.toHaveBeenCalled()
    expect(engineCalls()).toBe(0)
  })
})

describe.each(
  COMMANDS
)('a project folder that is not there on %s', (command) => {
  const parent = makeTempFolder('extjs-missing-project-')
  const missing = path.join(parent, 'not-here')
  const message = `No project folder at ${missing}.`
  const hint = `Run \`extension ${command}\` inside your extension project, or pass its path.`

  it('is refused on stderr with the folder and the fix', async () => {
    expect(await run([command, missing])).toBe(1)
    expect(stderrLines()).toEqual([`⏵⏵⏵ Error: ${message}\n${hint}`])
    expect(logSpy).not.toHaveBeenCalled()
    expect(extensionBuild).not.toHaveBeenCalled()
    expect(extensionDev).not.toHaveBeenCalled()
    expect(extensionPreview).not.toHaveBeenCalled()
  })

  it('is one usage frame and no prose under --output json', async () => {
    expect(await run([command, missing, '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command,
        status: 'usage',
        value: null,
        error: {code: 'E_PROJECT_NOT_FOUND', message},
        warnings: [],
        hint
      }
    ])

    expect(stderrLines()).toEqual([])
  })

  it('resolves a relative path against the working directory', async () => {
    expect(await run([command, path.relative(process.cwd(), missing)])).toBe(1)

    expect(stderrLines()).toEqual([`⏵⏵⏵ Error: ${message}\n${hint}`])
  })
})

describe('an unsupported browser', () => {
  const everyTarget = SUPPORTED_BROWSER_TARGETS.join(', ')
  const runnable = SUPPORTED_BROWSER_TARGETS.filter(
    (target) => !isEmulatorVendor(target) && !isSafariVendor(target)
  ).join(', ')

  it.each([
    ['build', everyTarget],
    ['dev', everyTarget],
    ['start', runnable],
    ['preview', runnable]
  ])('reads the same on %s, naming what that command can run', async (command, targets) => {
    expect(
      await run([command, '.', '--browser', 'netscape', '--output', 'json'])
    ).toBe(1)

    expect(frames()).toMatchObject([
      {
        status: 'usage',
        error: {
          code: 'E_UNSUPPORTED_BROWSER',
          message: `Unsupported browser: netscape. Choose one of: ${targets}.`
        }
      }
    ])
  })
})

describe('missingProjectFolder', () => {
  const cwd = makeTempFolder('extjs-project-folder-')

  it.each([
    [undefined, undefined],
    ['', undefined],
    ['.', undefined],
    [cwd, undefined],
    ['https://example.com/extension.zip', undefined],
    ['file:///nowhere', undefined],
    ['nope', path.join(cwd, 'nope')],
    // A single letter before the colon is a Windows drive, not a scheme.
    ['C:/nowhere', path.resolve(cwd, 'C:/nowhere')]
  ])('reads %j as missing folder %j', (typed, folder) => {
    expect(missingProjectFolder(typed, cwd)).toBe(folder)
  })
})

it('reports the refused output value with its code on dev', async () => {
  expect(await run(['dev', '.', '--output', 'jsno'])).toBe(1)
  expect(reportFailure).toHaveBeenCalledWith({
    code: 'E_INVALID_OPTION',
    exitCode: 1
  })
})

// Every register function in commands/, so a command that adds --output is
// checked here the moment it exists, with no row to remember.
async function everyCommand(): Promise<Command> {
  const program = new Command()
  program.exitOverride()

  const folder = path.join(__dirname, '..', 'commands')

  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.ts'))) {
    const module = await import(path.join(folder, file))

    for (const [name, register] of Object.entries(module)) {
      if (/^register\w+$/.test(name) && typeof register === 'function') {
        register(program)
      }
    }
  }

  return program
}

describe('every command that registers --output', async () => {
  const program = await everyCommand()
  const takingOutput = program.commands.filter((command) =>
    command.options.some((option) => option.long === '--output')
  )
  const action = vi.fn()

  // The action is swapped for a spy, so a command the check misses records a
  // call here instead of building, installing or dialing anything.
  for (const command of takingOutput) command.action(action)

  it('includes the commands this check was first written for', () => {
    expect(takingOutput.map((command) => command.name()).sort()).toEqual(
      expect.arrayContaining([
        'build',
        'capabilities',
        'dev',
        'doctor',
        'logs',
        'preview',
        'publish',
        'start',
        'telemetry'
      ])
    )
  })

  it.each(
    takingOutput.map((command) => [command.name(), command] as const)
  )('refuses a value %s cannot read, before its action', async (name, command) => {
    const flags = String(
      command.options.find((option) => option.long === '--output')?.flags
    )
    const choices = /<([^>]+)>/.exec(flags)?.[1].split('|') ?? []
    const listed = `${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}`
    // Placeholders for required arguments, which commander checks first.
    const positionals = command.registeredArguments
      .filter((argument) => argument.required)
      .map(() => 'placeholder')

    expect(
      await runCli(program, [name, ...positionals, '--output', 'jsno'])
    ).toBe(1)

    expect(stderrLines()).toEqual([
      `⏵⏵⏵ Error: --output got "jsno". Use ${listed}.`
    ])

    expect(logSpy).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('lets logs keep ndjson, the format it streams when piped', async () => {
    expect(await runCli(program, ['logs', '--output', 'ndjson'])).toBe(0)
    expect(stderrLines()).toEqual([])
    expect(action).toHaveBeenCalledTimes(1)
  })
})

// Every key of each options type, checked both ways at compile time: a key
// missing here or one the type does not declare fails tsconfig.spec.json.
const BUILD_KEYS = [
  'browser',
  'polyfill',
  'zip',
  'zipSource',
  'zipFilename',
  'zipDir',
  'sourceMaps',
  'outDir',
  'silent',
  'addonLint',
  'minify',
  'install',
  'extensions',
  'mode',
  'open',
  'appName',
  'bundleId',
  'developmentTeam',
  'macosOnly',
  'appIcon',
  'forceRegenerate',
  'debug',
  'output',
  'authorMode'
] as const satisfies readonly (keyof BuildOptions)[]
expectTypeOf<keyof BuildOptions>().toEqualTypeOf<(typeof BUILD_KEYS)[number]>()

const DEV_KEYS = [
  'browser',
  'profile',
  'chromiumBinary',
  'geckoBinary',
  'firefoxBinary',
  'safariBinary',
  'appName',
  'bundleId',
  'developmentTeam',
  'macosOnly',
  'appIcon',
  'forceRegenerate',
  'enableExtension',
  'polyfill',
  'open',
  'port',
  'host',
  'publicHost',
  'allowedHosts',
  'startingUrl',
  'logContext',
  'logs',
  'logFormat',
  'logTimestamps',
  'logColor',
  'logUrl',
  'logTab',
  'install',
  'extensions',
  'wait',
  'waitTimeout',
  'waitFormat',
  'allowControl',
  'allowEval',
  'parentPid',
  'output',
  'debug',
  'authorMode'
] as const satisfies readonly (keyof DevOptions)[]
expectTypeOf<keyof DevOptions>().toEqualTypeOf<(typeof DEV_KEYS)[number]>()

const START_KEYS = [
  'browser',
  'profile',
  'chromiumBinary',
  'geckoBinary',
  'firefoxBinary',
  'startingUrl',
  'port',
  'host',
  'publicHost',
  'polyfill',
  'open',
  'install',
  'debug',
  'authorMode',
  'logs',
  'logContext',
  'logFormat',
  'logTimestamps',
  'logColor',
  'logUrl',
  'logTab',
  'extensions',
  'allowControl',
  'allowEval',
  'wait',
  'waitTimeout',
  'waitFormat',
  'output'
] as const satisfies readonly (keyof StartOptions)[]
expectTypeOf<keyof StartOptions>().toEqualTypeOf<(typeof START_KEYS)[number]>()

const PREVIEW_KEYS = [
  'browser',
  'profile',
  'chromiumBinary',
  'geckoBinary',
  'firefoxBinary',
  'open',
  'startingUrl',
  'port',
  'logs',
  'logContext',
  'logFormat',
  'logTimestamps',
  'logColor',
  'logUrl',
  'logTab',
  'extensions',
  'allowControl',
  'allowEval',
  'outputPath',
  'output',
  'debug',
  'authorMode'
] as const satisfies readonly (keyof PreviewOptions)[]
expectTypeOf<keyof PreviewOptions>().toEqualTypeOf<
  (typeof PREVIEW_KEYS)[number]
>()

// commander is the only caller of these actions, so a key no flag sets is
// always undefined. The typechecker refuses a read of any other key, aliased
// or not, unless a cast hides it, which is why casts are refused here too.
describe.each([
  ['build', 'buildOptions', BUILD_KEYS, registerBuildCommand],
  ['dev', 'devOptions', DEV_KEYS, registerDevCommand],
  ['start', 'startOptions', START_KEYS, registerStartCommand],
  ['preview', 'previewOptions', PREVIEW_KEYS, registerPreviewCommand]
] as const)('the options the %s action reads', (name, variable, keys, register) => {
  const command = makeProgram((program) => register(program)).commands.find(
    (registered) => registered.name() === name
  )
  const settable = new Set(
    (command?.options ?? []).map((option) => option.attributeName())
  )

  it('declares only keys a registered flag sets', () => {
    expect(keys.filter((key) => !settable.has(key))).toEqual([])
  })

  it('reads no option through a cast', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'commands', `${name}.ts`),
      'utf8'
    )

    expect(source).not.toMatch(new RegExp(`\\(?\\s*${variable} as `))
  })
})

const LOGS_TEXT =
  '--logs got "verbos". Use off, error, warn, info, debug, trace or all.'

describe.each([
  ['dev', ['--logs', 'verbos'], LOGS_TEXT],
  ['start', ['--logs', 'verbos'], LOGS_TEXT],
  ['preview', ['--logs', 'verbos'], LOGS_TEXT],
  [
    'dev',
    ['--log-format', 'yaml'],
    '--log-format got "yaml". Use pretty, json or ndjson.'
  ],
  [
    'start',
    ['--log-format', 'yaml'],
    '--log-format got "yaml". Use pretty, json or ndjson.'
  ],
  [
    'preview',
    ['--log-format', 'yaml'],
    '--log-format got "yaml". Use pretty, json or ndjson.'
  ],
  [
    'build',
    ['--mode', 'fastest'],
    '--mode got "fastest". Use development, production or none.'
  ]
] as const)('%s %j', (command, flags, message) => {
  it('is refused on stderr with nothing on stdout', async () => {
    expect(await run([command, '.', ...flags])).toBe(1)
    expect(stderrLines()).toEqual([`⏵⏵⏵ Error: ${message}`])
    expect(logSpy).not.toHaveBeenCalled()
    expect(engineCalls()).toBe(0)
  })

  it('is one usage frame and no prose under --output json', async () => {
    expect(await run([command, '.', ...flags, '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command,
        status: 'usage',
        value: null,
        error: {code: 'E_INVALID_OPTION', message},
        warnings: []
      }
    ])

    expect(stderrLines()).toEqual([])
    expect(engineCalls()).toBe(0)
  })
})

it.each([
  'dev',
  'start',
  'preview'
])('still reads --logs INFO on %s, as case never mattered', async (command) => {
  expect(await run([command, '.', '--logs', ' INFO '])).toBe(0)
  expect(stderrLines()).toEqual([])
})

// Closed lists a command checks in its action instead of this hook, each with
// the reason. A new entry here is a decision a reviewer should see.
const CHECKED_IN_ACTION: Record<string, string> = {
  'logs --level':
    "the bridge's published rule decides, and it also takes log and any case"
}

describe('every flag that declares a closed list of choices', async () => {
  const program = await everyCommand()
  const action = vi.fn()
  const rows = program.commands.flatMap((command) =>
    command.options
      .map((option) => [command, option, declaredChoices(option)] as const)
      .filter(([, , choices]) => choices !== undefined)
      .map(([, option, choices]) => {
        command.action(action)

        return [
          `${command.name()} ${option.long}`,
          command,
          String(option.long),
          choices as string[]
        ] as const
      })
  )

  it('includes --logs on dev, start and preview, and names each exemption', () => {
    const names = rows.map(([name]) => name)

    expect(names).toEqual(
      expect.arrayContaining(['dev --logs', 'start --logs', 'preview --logs'])
    )

    expect(names).toEqual(
      expect.arrayContaining(Object.keys(CHECKED_IN_ACTION))
    )
  })

  it.each(
    rows.filter(([name]) => !(name in CHECKED_IN_ACTION))
  )('refuses a value %s does not list, before the action', async (_name, command, flag, choices) => {
    const listed = `${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}`
    const positionals = command.registeredArguments
      .filter((argument) => argument.required)
      .map(() => 'placeholder')

    expect(
      await runCli(program, [command.name(), ...positionals, flag, 'nope'])
    ).toBe(1)

    expect(stderrLines()[0]?.split('\n')[0]).toBe(
      `⏵⏵⏵ Error: ${flag} got "nope". Use ${listed}.`
    )

    expect(logSpy).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
})

// An unknown context used to be dropped, and a list left empty that way
// showed every context: the opposite of the filter that was typed.
describe('--log-context names only contexts that exist', () => {
  const contexts = `${LOG_CONTEXTS.join(', ')} or all`

  describe.each(['dev', 'start', 'preview'])('on %s', (command) => {
    it.each([
      ['popp', 'popp'],
      ['background, nope ,content', 'nope'],
      ['nope,popp', 'nope, popp']
    ])('refuses %j on stderr before anything runs', async (value, unknown) => {
      const project = makeTempFolder('extjs-log-context-')

      expect(await run([command, project, '--log-context', value])).toBe(1)
      expect(stderrLines()).toEqual([
        `⏵⏵⏵ Error: --log-context got "${unknown}". Use ${contexts}.`
      ])

      expect(logSpy).not.toHaveBeenCalled()
      expect(engineCalls()).toBe(0)
    })

    it('frames the refusal as E_INVALID_OPTION usage under --output json', async () => {
      const project = makeTempFolder('extjs-log-context-')

      expect(
        await run([
          command,
          project,
          '--log-context',
          'popp',
          '--output',
          'json'
        ])
      ).toBe(1)

      expect(frames()).toEqual([
        {
          schema: 1,
          ok: false,
          command,
          status: 'usage',
          value: null,
          error: {
            code: 'E_INVALID_OPTION',
            message: `--log-context got "popp". Use ${contexts}.`
          },
          warnings: []
        }
      ])

      expect(engineCalls()).toBe(0)
    })
  })
})
