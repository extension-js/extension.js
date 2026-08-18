import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    existsSync: vi.fn()
  }
})

vi.mock('../lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

vi.mock('../lib/config-loader', () => ({
  loadCommandConfig: vi.fn(async () => ({})),
  loadBrowserConfig: vi.fn(async () => ({}))
}))

vi.mock('../lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('../plugin-special-folders/folder-extensions/resolve-dirs', () => ({
  resolveCompanionExtensionDirs: vi.fn(() => ['/comp/a'])
}))
vi.mock('../plugin-special-folders/folder-extensions/resolve-config', () => ({
  resolveCompanionExtensionsConfig: vi.fn(async () => ({paths: ['/comp/a']}))
}))
vi.mock('../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined}))
}))

vi.mock('../lib/extensions-to-load', () => ({
  computeExtensionsToLoad: vi.fn(() => ['/theme', '/comp/a', '/out'])
}))

vi.mock('../lib/dark-mode', () => ({
  withDarkMode: vi.fn(({browserFlags, preferences}: any) => ({
    browserFlags,
    preferences
  }))
}))

const metadataWriter = vi.hoisted(() => ({
  readyPath: '',
  setManagedExtensionDirs: vi.fn(),
  writeStarting: vi.fn(),
  writeReady: vi.fn(),
  writeError: vi.fn(),
  appendEvent: vi.fn()
}))
const createAutomationMetadataWriter = vi.fn(() => metadataWriter)
vi.mock('../plugin-playwright', () => ({
  createPlaywrightMetadataWriter: (...args: any[]) =>
    createAutomationMetadataWriter(...args),
  getSessionRunId: vi.fn(() => 'preview-run')
}))

const runOnlyPreviewBrowser = vi.fn(async (..._args: any[]) => {})

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

import {extensionPreview} from '../command-preview'
import * as configLoaderMod from '../lib/config-loader'
import {withDarkMode} from '../lib/dark-mode'
import * as extensionsToLoadMod from '../lib/extensions-to-load'
import * as projectMod from '../lib/project'
import * as validateDepsMod from '../lib/validate-user-dependencies'
import * as resolveConfigMod from '../plugin-special-folders/folder-extensions/resolve-config'
import * as resolveDirsMod from '../plugin-special-folders/folder-extensions/resolve-dirs'

describe('webpack/command-preview (run-only)', () => {
  let metadataRoot = ''

  beforeEach(() => {
    vi.resetModules()
    runOnlyPreviewBrowser.mockClear()
    logSpy.mockClear()
    ;(fs.existsSync as any)?.mockReset?.()
    ;(resolveConfigMod as any).resolveCompanionExtensionsConfig?.mockClear?.()
    ;(resolveDirsMod as any).resolveCompanionExtensionDirs?.mockClear?.()
    ;(validateDepsMod as any).assertNoManagedDependencyConflicts?.mockClear?.()
    metadataWriter.writeStarting.mockClear()
    metadataWriter.writeReady.mockClear()
    metadataWriter.writeError.mockClear()
    metadataWriter.appendEvent.mockClear()
    createAutomationMetadataWriter.mockClear()
    metadataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-preview-meta-'))
    metadataWriter.readyPath = path.join(metadataRoot, 'ready.json')
    metadataWriter.writeStarting.mockImplementation(() => {
      fs.writeFileSync(
        metadataWriter.readyPath,
        JSON.stringify({runId: 'preview-run', pid: 1234, status: 'starting'}),
        'utf-8'
      )
    })
    metadataWriter.writeReady.mockImplementation(() => {
      fs.writeFileSync(
        metadataWriter.readyPath,
        JSON.stringify({runId: 'preview-run', pid: 1234, status: 'ready'}),
        'utf-8'
      )
    })
    metadataWriter.writeError.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(metadataRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  it('falls back to manifest directory when dist/<browser> lacks manifest.json', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return false
      if (p === path.join('/proj', 'manifest.json')) return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    expect(call.outPath).toBe('/proj')
  })

  it('says so when it falls back to the source manifest dir', async () => {
    const localLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return false
      if (p === path.join('/proj', 'manifest.json')) return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    const printed = localLog.mock.calls
      .map((c: any[]) => String(c[0]))
      .join('\n')
    expect(printed).toContain('previewing the source manifest directory')
    expect(printed).toContain('extension build --browser chrome')
  })

  it('stays quiet about the fallback when dist/<browser> is served', async () => {
    const localLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    const printed = localLog.mock.calls
      .map((c: any[]) => String(c[0]))
      .join('\n')
    expect(printed).not.toContain('previewing the source manifest directory')
  })

  it('describes itself as preview by default', async () => {
    const localLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    const printed = localLog.mock.calls
      .map((c: any[]) => String(c[0]))
      .join('\n')
    expect(printed).toContain('Previewing on Chrome.')
    expect(printed).not.toContain('Starting on')
  })

  it('describes itself as start when invoked by start', async () => {
    const localLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome', metadataCommand: 'start'} as any,
      runOnlyPreviewBrowser
    )

    const printed = localLog.mock.calls
      .map((c: any[]) => String(c[0]))
      .join('\n')
    expect(printed).toContain('Starting on Chrome.')
    expect(printed).not.toContain('Previewing on')
  })

  it('keeps the previewing banner off stdout in machine mode', async () => {
    const originalOutput = process.env.EXTENSION_OUTPUT
    process.env.EXTENSION_OUTPUT = 'json'
    const localLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    try {
      await extensionPreview(
        '/proj',
        {browser: 'chrome'} as any,
        runOnlyPreviewBrowser
      )

      expect(localLog).not.toHaveBeenCalled()
    } finally {
      if (originalOutput === undefined) delete process.env.EXTENSION_OUTPUT
      else process.env.EXTENSION_OUTPUT = originalOutput
    }
  })

  it('uses dist/<browser> when dist manifest exists', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    expect(call.outPath).toBe(path.join('/proj', 'dist', 'chrome'))
  })

  it('uses an explicit outputPath over dist/<browser>', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      if (p === path.join('/custom/unpacked', 'manifest.json')) return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome', outputPath: '/custom/unpacked'} as any,
      runOnlyPreviewBrowser
    )

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    // asAbsolute keeps already-absolute input verbatim on every platform;
    // path.resolve would rewrite this to D:\... on Windows and diverge.
    expect(call.outPath).toBe('/custom/unpacked')
  })

  it('throws when outputPath does not contain manifest.json', async () => {
    ;(fs.existsSync as any).mockImplementation(() => false)

    await expect(
      extensionPreview(
        '/proj',
        {browser: 'chrome'} as any,
        runOnlyPreviewBrowser
      )
    ).rejects.toThrow(/Preview is run-only and does not compile/)

    expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
    expect(metadataWriter.writeError).toHaveBeenCalledWith(
      'preview_manifest_missing',
      expect.stringContaining('Expected manifest at')
    )
  })

  it('skips browser launch when noBrowser is true', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {
        browser: 'chrome',
        noBrowser: true
      } as any,
      runOnlyPreviewBrowser
    )

    expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
    expect(metadataWriter.writeStarting).toHaveBeenCalledTimes(1)
    expect(metadataWriter.writeReady).toHaveBeenCalledTimes(1)
    const output = consoleSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Run ID')
    expect(output).toContain('preview-run')
    expect(output).toContain('Previewing on Chrome (no-browser mode).')
    expect(output).not.toContain('Skipping the browser launch')
    consoleSpy.mockRestore()
  })

  it('shows Run ID for firefox no-browser preview', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'firefox', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {
        browser: 'firefox',
        noBrowser: true
      } as any,
      runOnlyPreviewBrowser
    )

    expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
    const output = consoleSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(output).toContain('Run ID')
    expect(output).toContain('preview-run')
    expect(output).toContain('Firefox (no-browser mode)')
    consoleSpy.mockRestore()
  })

  it('keeps the no-browser card off stdout in machine mode', async () => {
    const originalOutput = process.env.EXTENSION_OUTPUT
    process.env.EXTENSION_OUTPUT = 'json'
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    try {
      await extensionPreview(
        '/proj',
        {
          browser: 'chrome',
          noBrowser: true
        } as any,
        runOnlyPreviewBrowser
      )

      expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      if (originalOutput === undefined) delete process.env.EXTENSION_OUTPUT
      else process.env.EXTENSION_OUTPUT = originalOutput
      consoleSpy.mockRestore()
    }
  })

  it('resolves companion extensions before scanning', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {
        browser: 'chrome',
        extensions: [
          'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi'
        ]
      } as any,
      runOnlyPreviewBrowser
    )

    expect(
      resolveConfigMod.resolveCompanionExtensionsConfig
    ).toHaveBeenCalledWith({
      projectRoot: '/proj',
      browser: 'chrome',
      config: [
        'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi'
      ]
    })
    expect(resolveDirsMod.resolveCompanionExtensionDirs).toHaveBeenCalledWith(
      expect.objectContaining({config: {paths: ['/comp/a']}})
    )
  })

  it('passes built-in devtools + theme + user output to preview runner', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    ;(extensionsToLoadMod.computeExtensionsToLoad as any).mockReturnValue([
      '/builtins/devtools',
      '/builtins/theme',
      '/comp/a',
      path.join('/proj', 'dist', 'chrome')
    ])

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    expect(extensionsToLoadMod.computeExtensionsToLoad).toHaveBeenCalledWith(
      expect.any(String),
      'production',
      'chrome',
      path.join('/proj', 'dist', 'chrome'),
      ['/comp/a'],
      '/proj/manifest.json'
    )
    expect(runOnlyPreviewBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        readyPath: metadataWriter.readyPath,
        extensionsToLoad: [
          '/builtins/devtools',
          '/builtins/theme',
          '/comp/a',
          path.join('/proj', 'dist', 'chrome')
        ]
      })
    )
  })

  it('loads commands.preview config when invoked as preview', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    expect(configLoaderMod.loadCommandConfig).toHaveBeenCalledWith(
      '/proj',
      'preview'
    )
  })

  it('loads commands.start config when invoked via start delegation', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })
    ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
      profile: '/from/commands/start',
      browserFlags: ['--start-flag']
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome', metadataCommand: 'start'} as any,
      runOnlyPreviewBrowser
    )

    expect(configLoaderMod.loadCommandConfig).toHaveBeenCalledWith(
      '/proj',
      'start'
    )
    const call = runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    expect(call.profile).toBe('/from/commands/start')
    expect(call.browserFlags).toEqual(['--start-flag'])
  })

  describe.each([
    {label: 'preview', metadataCommand: undefined as 'start' | undefined},
    {label: 'start', metadataCommand: 'start' as const}
  ])('option precedence for $label (CLI > commands.$label > browser > defaults)', ({
    label,
    metadataCommand
  }) => {
    function setupDist() {
      ;(fs.existsSync as any).mockImplementation((p: string) => {
        if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
          return true
        return false
      })
    }

    function launched() {
      return runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    }

    it('applies stock logger defaults when neither config nor CLI sets them', async () => {
      setupDist()
      ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValueOnce({})
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({})

      await extensionPreview(
        '/proj',
        {browser: 'chrome', metadataCommand} as any,
        runOnlyPreviewBrowser
      )

      expect(launched()).toMatchObject({
        logFormat: 'pretty',
        logTimestamps: true,
        logColor: true,
        logLevel: 'off'
      })
    })

    it(`lets commands.${label} beat browser config for logger options (config-only)`, async () => {
      setupDist()
      ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValueOnce({
        startingUrl: 'https://from-browser.example'
      })
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        startingUrl: `https://from-commands-${label}.example`,
        logFormat: 'json',
        logColor: false,
        logLevel: 'debug'
      })

      await extensionPreview(
        '/proj',
        {browser: 'chrome', metadataCommand} as any,
        runOnlyPreviewBrowser
      )

      expect(launched()).toMatchObject({
        startingUrl: `https://from-commands-${label}.example`,
        logFormat: 'json',
        logColor: false,
        logLevel: 'debug'
      })
    })

    it(`lets explicit CLI values beat commands.${label} in both directions (both)`, async () => {
      setupDist()
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        startingUrl: `https://from-commands-${label}.example`,
        logFormat: 'json',
        logColor: false
      })

      await extensionPreview(
        '/proj',
        {
          browser: 'chrome',
          metadataCommand,
          startingUrl: 'https://from-cli.example',
          logFormat: 'pretty',
          logColor: true
        } as any,
        runOnlyPreviewBrowser
      )

      expect(launched()).toMatchObject({
        startingUrl: 'https://from-cli.example',
        logFormat: 'pretty',
        logColor: true
      })
    })

    it('applies flag-only logger values over stock defaults (flag-only)', async () => {
      setupDist()
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({})

      await extensionPreview(
        '/proj',
        {
          browser: 'chrome',
          metadataCommand,
          logFormat: 'ndjson',
          logColor: false
        } as any,
        runOnlyPreviewBrowser
      )

      expect(launched()).toMatchObject({
        logFormat: 'ndjson',
        logColor: false,
        logTimestamps: true
      })
    })

    it('concatenates browserFlags and deep-merges preferences across layers', async () => {
      setupDist()
      ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValueOnce({
        browserFlags: ['--from-browser'],
        preferences: {a: 1, nested: {x: 1}}
      })
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        browserFlags: ['--from-command'],
        preferences: {b: 2, nested: {y: 2}}
      })

      await extensionPreview(
        '/proj',
        {
          browser: 'chrome',
          metadataCommand,
          browserFlags: ['--from-cli'],
          preferences: {a: 99, nested: {x: 3}}
        } as any,
        runOnlyPreviewBrowser
      )

      expect(launched()).toMatchObject({
        browserFlags: ['--from-browser', '--from-command', '--from-cli'],
        preferences: {a: 99, b: 2, nested: {x: 3, y: 2}}
      })
    })

    it('hands excludeBrowserFlags to the shared appearance defaults', async () => {
      setupDist()
      ;(withDarkMode as any).mockClear()

      await extensionPreview(
        '/proj',
        {
          browser: 'chrome',
          metadataCommand,
          excludeBrowserFlags: ['--force-dark-mode']
        } as any,
        runOnlyPreviewBrowser
      )

      expect(withDarkMode).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeBrowserFlags: ['--force-dark-mode']
        })
      )
    })
  })

  it('checks managed dependency conflicts using package root when manifest is in src', async () => {
    ;(projectMod.getProjectStructure as any).mockResolvedValueOnce({
      manifestPath: '/proj/src/manifest.json',
      packageJsonPath: '/proj/package.json'
    })
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview(
      '/proj',
      {browser: 'chrome'} as any,
      runOnlyPreviewBrowser
    )

    expect(
      validateDepsMod.assertNoManagedDependencyConflicts
    ).toHaveBeenCalledWith('/proj/package.json', '/proj')
  })
})
