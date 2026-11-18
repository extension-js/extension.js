import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {isValidBundleId} from '../browsers/run-safari/safari-launch/safari-config'
import {registerBuildCommand} from '../commands/build'
import {registerDevCommand} from '../commands/dev'
import {registerPreviewCommand} from '../commands/preview'
import {registerStartCommand} from '../commands/start'
import {parseParentPid} from '../helpers/parent-watchdog'
import {
  classifyManagedInstallTarget,
  installTargets,
  isEmulatorVendor,
  isSafariVendor,
  SUPPORTED_BROWSER_TARGETS,
  validateVendors,
  vendors
} from '../helpers/vendors'
import {
  makeProgram,
  runCli,
  stubCommandEnv,
  stubProcessExit
} from './command-harness'
import {developStandIn, previewStandIn} from './helpers/engine-stand-ins'

const extensionBuild = vi.fn(async (_path: string, _options: unknown) => {})
const extensionDev = vi.fn(async (_path: string, _options: unknown) => {})
const extensionPreview = vi.fn(async (_path: string, _options: unknown) => {})
const loadCommandConfig = vi.fn(async () => ({}))
const launcher = vi.fn(async () => {})
const runBrowser = vi.fn(async () => {})
const armParentWatchdog = vi.fn((_pid: number, _options: unknown) => () => {})
const waitForReady = vi.fn(async () => {
  throw new Error('this spec never waits')
})

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
        launcher: launcher as never,
        safariPreflight: () => null,
        armParentWatchdog: armParentWatchdog as never,
        waitForReady: waitForReady as never
      })

      registerStartCommand(program, {
        loadDevelop,
        loadPreview,
        runBrowser: runBrowser as never,
        waitForReady: waitForReady as never
      })

      registerPreviewCommand(program, {
        loadDevelop,
        loadPreview,
        runBrowser: runBrowser as never
      })
    }),
    argv
  )
}

function frames(): Array<Record<string, unknown>> {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

function engineCalls(): number {
  return (
    extensionBuild.mock.calls.length +
    extensionDev.mock.calls.length +
    extensionPreview.mock.calls.length
  )
}

describe('an empty --browser', () => {
  const everyTarget = SUPPORTED_BROWSER_TARGETS.join(', ')
  const runOnlyTargets = SUPPORTED_BROWSER_TARGETS.filter(
    (target) => !isEmulatorVendor(target) && !isSafariVendor(target)
  ).join(', ')

  it.each([
    ['', ['']],
    [',', ['']],
    [' , ', ['']],
    ['chrome,,firefox', ['chrome', '', 'firefox']]
  ])('keeps an empty item of %j for the validator to refuse', (value, list) => {
    let refused: string | undefined

    expect(vendors(value as never)).toEqual(list)
    expect(
      validateVendors(list, (invalid) => {
        refused = invalid
      })
    ).toBe(false)

    expect(refused).toBe('')
  })

  it('still reads an empty install target list as empty', () => {
    expect(installTargets('' as never)).toEqual([])
    expect(installTargets('chrome,,firefox' as never)).toEqual([
      'chrome',
      'firefox'
    ])
  })

  describe.each([
    ['build', everyTarget],
    ['dev', everyTarget],
    ['start', runOnlyTargets],
    ['preview', runOnlyTargets]
  ])('on %s', (command, targets) => {
    it.each([
      '--browser=',
      '--browser=,',
      '--browser=chrome,,firefox'
    ])('refuses %s on stderr, runs nothing and exits 1', async (flag) => {
      expect(await run([command, '.', flag])).toBe(1)
      expect(engineCalls()).toBe(0)
      expect(launcher).not.toHaveBeenCalled()
      expect(runBrowser).not.toHaveBeenCalled()
      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls.map((call) => String(call[0]))).toEqual([
        `⏵⏵⏵ --browser got an empty value.\nChoose one of: ${targets}.`
      ])
    })

    it.each([
      '--browser=',
      '--browser=,',
      '--browser=chrome,,firefox'
    ])('frames %s as E_UNSUPPORTED_BROWSER usage under --output json', async (flag) => {
      expect(await run([command, '.', flag, '--output', 'json'])).toBe(1)
      expect(engineCalls()).toBe(0)
      expect(frames()).toEqual([
        {
          schema: 1,
          ok: false,
          command,
          status: 'usage',
          value: null,
          error: {
            code: 'E_UNSUPPORTED_BROWSER',
            message: `--browser got an empty value. Choose one of: ${targets}.`
          },
          warnings: []
        }
      ])
    })
  })
})

describe('a repeated or capitalized --browser', () => {
  it('builds chrome once for chrome,chrome', async () => {
    expect(await run(['build', '.', '--browser', 'chrome,chrome'])).toBe(0)
    expect(
      extensionBuild.mock.calls.map(
        ([, options]) => (options as {browser: string}).browser
      )
    ).toEqual(['chrome'])
  })

  it('reads Chrome on build as chrome, as install does', async () => {
    expect(classifyManagedInstallTarget('Chrome')).toBe('managed')
    expect(await run(['build', '.', '--browser', ' Chrome,FIREFOX'])).toBe(0)
    expect(
      extensionBuild.mock.calls.map(
        ([, options]) => (options as {browser: string}).browser
      )
    ).toEqual(['chrome', 'firefox'])
  })

  it.each([
    ['ALL', ['chrome', 'edge', 'firefox']],
    ['Chrome,chrome , CHROME', ['chrome']],
    ['firefox,,', ['firefox', '']]
  ])('lists %j as %j', (value, list) => {
    expect(vendors(value as never)).toEqual(list)
  })
})

describe('--parent-pid values that are not a whole number', () => {
  it.each(['1e3', '12abc', '1.5'])('reads no pid from %j', (value) => {
    expect(parseParentPid(value)).toBeUndefined()
  })

  it('refuses --parent-pid 1e3 on dev and arms no watchdog', async () => {
    expect(await run(['dev', '.', '--parent-pid', '1e3'])).toBe(1)
    expect(armParentWatchdog).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '⏵⏵⏵ --parent-pid got "1e3". Use the process id to watch, in digits, such as 4242.'
    ])
  })
})

describe('a bundle id with no dot', () => {
  it.each([
    'build',
    'dev'
  ])('is refused on %s with an example built from it', async (command) => {
    // Apple's own rule takes a single label, so the refusal is ours.
    expect(isValidBundleId('myapp')).toBe(true)
    expect(
      await run([
        command,
        '.',
        '--browser',
        'safari',
        '--bundle-id',
        'myapp',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(engineCalls()).toBe(0)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command,
        status: 'usage',
        value: null,
        error: {
          code: 'E_INVALID_OPTION',
          message:
            '--bundle-id got "myapp". Use reverse DNS form, such as com.example.myapp.'
        },
        warnings: []
      }
    ])
  })

  it('still builds with a reverse DNS bundle id', async () => {
    expect(
      await run([
        'build',
        '.',
        '--browser',
        'safari',
        '--bundle-id',
        'com.example.myapp'
      ])
    ).toBe(0)

    expect(
      extensionBuild.mock.calls.map(
        ([, options]) => (options as {bundleId: string}).bundleId
      )
    ).toEqual(['com.example.myapp'])
  })
})
