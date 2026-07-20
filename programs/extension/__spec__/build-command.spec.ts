import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionBuild = vi.fn(async () => {})
const safariBuildPreflight = vi.fn(() => ({severity: 'ok', message: ''}))
const packageSafariExtension = vi.fn(async () => {})

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopModule: vi.fn(async () => ({extensionBuild}))
}))
vi.mock('../browsers/run-safari/safari-launch', () => ({
  packageSafariExtension: (...args: unknown[]) =>
    packageSafariExtension(...(args as [])),
  safariBuildPreflight: () => safariBuildPreflight()
}))
vi.mock('../browsers/run-safari/safari-launch/safari-config', () => ({
  isValidBundleId: (id: string) => id.includes('.') && !id.includes(' ')
}))

import {registerBuildCommand} from '../commands/build'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  safariBuildPreflight.mockReturnValue({severity: 'ok', message: ''})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerBuildCommand), argv)
}

describe('extension build', () => {
  it('builds with exitOnError and the validated mode', async () => {
    expect(await run(['build', '.', '--mode', 'development'])).toBe(0)
    expect(extensionBuild).toHaveBeenCalledTimes(1)
    const [projectPath, opts] = extensionBuild.mock.calls[0] as any[]
    expect(projectPath).toBe('.')
    expect(opts).toMatchObject({
      browser: 'chromium',
      exitOnError: true,
      mode: 'development'
    })
  })

  it('enables author diagnostics with --author', async () => {
    delete process.env.EXTENSION_AUTHOR_MODE
    delete process.env.EXTENSION_VERBOSE
    expect(await run(['build', '.', '--author'])).toBe(0)
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
    delete process.env.EXTENSION_AUTHOR_MODE
    delete process.env.EXTENSION_VERBOSE
  })

  it('exits on an unsupported browser name', async () => {
    expect(await run(['build', '.', '--browser', 'netscape'])).toBe(1)
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('rejects an invalid --mode before building', async () => {
    expect(await run(['build', '.', '--mode', 'fastest'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('Invalid --mode')
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('rejects safari-only flags for non-safari targets', async () => {
    expect(await run(['build', '.', '--app-name', 'My App'])).toBe(1)
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('rejects a malformed safari bundle id', async () => {
    expect(
      await run(['build', '.', '--browser', 'safari', '--bundle-id', 'bad id'])
    ).toBe(1)
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('fails fast when the safari preflight is fatal', async () => {
    safariBuildPreflight.mockReturnValue({
      severity: 'fatal',
      message: 'xcode is broken'
    })
    expect(await run(['build', '.', '--browser', 'safari'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('xcode is broken')
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('warns and disables packaging on a skip preflight', async () => {
    safariBuildPreflight.mockReturnValue({
      severity: 'skip',
      message: 'not macOS'
    })
    expect(await run(['build', '.', '--browser', 'safari'])).toBe(0)
    expect(String(warnSpy.mock.calls[0][0])).toContain('not macOS')
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(opts.safariPackager).toBeUndefined()
  })

  it('wires a safari packager that never opens the app by default', async () => {
    expect(await run(['build', '.'])).toBe(0)
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(typeof opts.safariPackager).toBe('function')

    await opts.safariPackager('/tmp/dist/safari', 'full')
    expect(packageSafariExtension).toHaveBeenCalledTimes(1)
    const [launchOpts, distPath, , mode] = packageSafariExtension.mock
      .calls[0] as any[]
    expect(launchOpts).toMatchObject({
      extension: ['/tmp/dist/safari'],
      noOpen: true,
      dryRun: false
    })
    expect(distPath).toBe('/tmp/dist/safari')
    expect(mode).toBe('full')
  })
})
