import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionBuild = vi.fn(async () => {})
const loadCommandConfig = vi.fn(async (): Promise<unknown> => ({}))
const safariBuildPreflight = vi.fn(() => ({severity: 'ok', message: ''}))
const packageSafariExtension = vi.fn(async () => {})

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopModule: vi.fn(async () => ({
    extensionBuild,
    loadCommandConfig
  }))
}))
vi.mock('../browsers/run-safari/safari-launch', () => ({
  packageSafariExtension: (...args: unknown[]) =>
    packageSafariExtension(...(args as [])),
  safariBuildPreflight: () => safariBuildPreflight()
}))
vi.mock('../browsers/run-safari/safari-launch/safari-config', () => ({
  isValidBundleId: (id: string) => id.includes('.') && !id.includes(' ')
}))

import {getBuildSummary} from '../../develop/lib/build-summary'
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
  it('adopts extension.config.js commands.build.browser when --browser is not typed', async () => {
    loadCommandConfig.mockResolvedValue({browser: 'firefox'})
    expect(await run(['build', './my-extension'])).toBe(0)
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(opts.browser).toBe('firefox')
    expect(loadCommandConfig).toHaveBeenCalledWith('./my-extension', 'build')
    loadCommandConfig.mockResolvedValue({})
  })

  it('lets a typed --browser beat commands.build.browser', async () => {
    loadCommandConfig.mockResolvedValue({browser: 'firefox'})
    expect(await run(['build', './my-extension', '--browser', 'edge'])).toBe(0)
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(opts.browser).toBe('edge')
    loadCommandConfig.mockResolvedValue({})
  })

  it('refuses an unsupported browser name coming from the config', async () => {
    loadCommandConfig.mockResolvedValue({browser: 'nope'})
    expect(await run(['build', './my-extension'])).not.toBe(0)
    expect(extensionBuild).not.toHaveBeenCalled()
    expect(String(errorSpy.mock.calls.flat().join(' '))).toMatch(/nope/)
    loadCommandConfig.mockResolvedValue({})
  })

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

  it('forwards --macos-only false so a universal project is reachable', async () => {
    expect(
      await run(['build', '.', '--browser', 'safari', '--macos-only', 'false'])
    ).toBe(0)
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(opts.macOsOnly).toBe(false)
  })

  it('treats a bare --macos-only as true', async () => {
    expect(
      await run(['build', '.', '--browser', 'safari', '--macos-only'])
    ).toBe(0)
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(opts.macOsOnly).toBe(true)
  })

  it('leaves macOsOnly unset when the flag is absent', async () => {
    expect(await run(['build', '.', '--browser', 'safari'])).toBe(0)
    const [, opts] = extensionBuild.mock.calls[0] as any[]
    expect(opts.macOsOnly).toBeUndefined()
  })

  it('rejects --macos-only false for non-safari targets', async () => {
    // `false` is a real value for this flag, not an unset boolean, so the
    // safari-only gate has to notice it rather than filter it out.
    expect(await run(['build', '.', '--macos-only', 'false'])).toBe(1)
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/--macos-only/)
  })

  it('carries the build summary in the --output json envelope', async () => {
    extensionBuild.mockResolvedValueOnce({
      browser: 'chromium',
      output_path: '/tmp/project/dist/chromium',
      total_assets: 3,
      total_bytes: 2048,
      largest_asset_bytes: 1024,
      warnings_count: 1,
      errors_count: 0,
      warnings: ['a warning']
    } as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(await run(['build', '.', '--output', 'json'])).toBe(0)

    const frame = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))
    expect(frame.ok).toBe(true)
    expect(frame.value.summaries).toHaveLength(1)
    expect(frame.value.summaries[0]).toMatchObject({
      browser: 'chromium',
      output_path: '/tmp/project/dist/chromium',
      total_bytes: 2048,
      warnings: ['a warning']
    })
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

    function emitJsonFrame(argv: string[]) {
      extensionBuild.mockResolvedValueOnce({
        browser: 'chromium',
        output_path: '/home/dev/my-extension/dist/chromium',
        total_assets: 12,
        total_bytes: 248320,
        largest_asset_bytes: 131072,
        warnings_count: 1,
        errors_count: 0,
        warnings: ['Asset size exceeds the recommended limit (128 KiB).']
      } as never)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      return run(argv).then((code) => {
        expect(code).toBe(0)
        return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))
      })
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
