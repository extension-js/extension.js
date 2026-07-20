import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionDev = vi.fn(async () => {})
const packageSafariExtension = vi.fn(async () => {})
const safariPreflightError = vi.fn((): string | null => null)
const setupParentWatchdog = vi.fn()
const runWaitMode = vi.fn(async () => ({
  format: 'json' as const,
  browsers: ['chromium'],
  results: [{browser: 'chromium', ok: true}]
}))

vi.mock('../browsers', () => ({
  launchBrowser: vi.fn(async () => {})
}))
vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopModule: vi.fn(async () => ({extensionDev}))
}))
vi.mock('../browsers/run-safari/safari-launch', () => ({
  packageSafariExtension: (...args: unknown[]) =>
    packageSafariExtension(...(args as [])),
  safariPreflightError: () => safariPreflightError()
}))
vi.mock('../browsers/run-safari/safari-launch/safari-config', () => ({
  isValidBundleId: (id: string) => id.includes('.') && !id.includes(' ')
}))
vi.mock('../helpers/parent-watchdog', () => ({
  parseParentPid: (value: unknown) => {
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : undefined
  },
  setupParentWatchdog: (pid: number) => setupParentWatchdog(pid)
}))
vi.mock('../commands/dev-wait', () => ({
  runWaitMode: (input: unknown) => runWaitMode(input as any)
}))

import {registerDevCommand} from '../commands/dev'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const ORIG_ENV = {...process.env}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  delete process.env.EXTENSION_CLI_NO_BROWSER
  delete process.env.EXTENSION_AUTHOR_MODE
  delete process.env.EXTENSION_VERBOSE
  safariPreflightError.mockReturnValue(null)
})

afterEach(() => {
  process.env = {...ORIG_ENV}
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerDevCommand), argv)
}

describe('extension dev', () => {
  it('runs the dev server with defaults and a browser launcher', async () => {
    expect(await run(['dev', './my-extension'])).toBe(0)
    expect(extensionDev).toHaveBeenCalledTimes(1)
    const [projectPath, devArgs] = extensionDev.mock.calls[0] as any[]
    expect(projectPath).toBe('./my-extension')
    expect(devArgs).toMatchObject({
      browser: 'chromium',
      polyfill: true,
      noBrowser: false,
      logLevel: 'off'
    })
    expect(devArgs.profile).toBeUndefined()
    expect(typeof devArgs.launcher).toBe('function')
  })

  it('normalizes --profile false and --polyfill false', async () => {
    expect(
      await run(['dev', '.', '--profile', 'false', '--polyfill', 'false'])
    ).toBe(0)
    const [, devArgs] = extensionDev.mock.calls[0] as any[]
    expect(devArgs.profile).toBe(false)
    expect(devArgs.polyfill).toBe(false)
  })

  it('drops the launcher when EXTENSION_CLI_NO_BROWSER is set', async () => {
    process.env.EXTENSION_CLI_NO_BROWSER = '1'
    expect(await run(['dev', '.'])).toBe(0)
    const [, devArgs] = extensionDev.mock.calls[0] as any[]
    expect(devArgs.noBrowser).toBe(true)
    expect(devArgs.launcher).toBeUndefined()
  })

  it('wires a safari packager that follows the --no-open decision', async () => {
    expect(await run(['dev', '.'])).toBe(0)
    const [, devArgs] = extensionDev.mock.calls[0] as any[]
    await devArgs.safariPackager('/tmp/dist/safari', 'resync')
    expect(packageSafariExtension).toHaveBeenCalledTimes(1)
    const [launchOpts, distPath, , mode] = packageSafariExtension.mock
      .calls[0] as any[]
    expect(launchOpts).toMatchObject({extension: ['/tmp/dist/safari']})
    expect(distPath).toBe('/tmp/dist/safari')
    expect(mode).toBe('resync')
  })

  it('arms the parent watchdog with a valid --parent-pid', async () => {
    expect(await run(['dev', '.', '--parent-pid', '4242'])).toBe(0)
    expect(setupParentWatchdog).toHaveBeenCalledWith(4242)
  })

  it('enables author diagnostics with --author', async () => {
    expect(await run(['dev', '.', '--author'])).toBe(0)
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })

  it('exits on an unsupported browser name', async () => {
    expect(await run(['dev', '.', '--browser', 'netscape'])).toBe(1)
    expect(extensionDev).not.toHaveBeenCalled()
  })

  it('rejects a malformed --parent-pid', async () => {
    expect(await run(['dev', '.', '--parent-pid', 'zero'])).toBe(1)
    expect(setupParentWatchdog).not.toHaveBeenCalled()
    expect(extensionDev).not.toHaveBeenCalled()
  })

  it('rejects safari-only flags for non-safari targets', async () => {
    expect(await run(['dev', '.', '--bundle-id', 'dev.example.app'])).toBe(1)
    expect(extensionDev).not.toHaveBeenCalled()
  })

  it('rejects a malformed safari bundle id', async () => {
    expect(
      await run(['dev', '.', '--browser', 'safari', '--bundle-id', 'bad id'])
    ).toBe(1)
    expect(extensionDev).not.toHaveBeenCalled()
  })

  it('fails fast when the safari toolchain preflight reports an issue', async () => {
    safariPreflightError.mockReturnValue('xcode missing')
    expect(await run(['dev', '.', '--browser', 'safari'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('xcode missing')
    expect(extensionDev).not.toHaveBeenCalled()
  })

  it('delegates --wait to wait mode and prints the json envelope', async () => {
    expect(await run(['dev', '.', '--wait', '--wait-format', 'json'])).toBe(0)
    expect(runWaitMode).toHaveBeenCalledWith(
      expect.objectContaining({command: 'dev', browsers: ['chromium']})
    )
    const payload = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(payload).toMatchObject({ok: true, mode: 'wait', command: 'dev'})
    expect(extensionDev).not.toHaveBeenCalled()
  })
})
