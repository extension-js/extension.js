import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  resolveSafariBuildConfig,
  composeConverterArgs,
  composeXcodebuildArgs,
  macOsSchemeName,
  xcodeProjectPath,
  builtAppPath,
  manifestFingerprintPath,
  saveManifestFingerprint,
  isProjectStale,
  pbxprojPath,
  extractXcodeUserSettings,
  applyXcodeUserSettings,
  backupAndRestoreXcodeSettings,
  isValidBundleId
} from '../run-safari/safari-launch/safari-config'
import {
  detectSafariToolchain,
  isMacOS
} from '../run-safari/safari-launch/toolchain'
import {launchBrowser} from '../index'
import {
  safariPreflightError,
  safariBuildPreflight,
  toolOutputTail
} from '../run-safari/safari-launch'
import * as messages from '../browsers-lib/messages'

function makeCompilation(out: string) {
  return {options: {output: {path: out}}} as any
}

function writeManifest(dir: string, manifest: Record<string, unknown>) {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
}

describe('run-safari config', () => {
  let distDir: string

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-'))
  })
  afterEach(() => {
    try {
      fs.rmSync(distDir, {recursive: true, force: true})
    } catch {}
  })

  it('derives app name and a converter-aligned bundle id from the manifest', () => {
    writeManifest(distDir, {name: 'My Cool Extension', version: '1.0.0'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari'
    } as any)

    expect(config.appName).toBe('My Cool Extension')
    // Case preserved + spaces→hyphens so it matches the app id the converter
    // derives from --app-name (keeps app/appex bundle ids prefix-aligned).
    expect(config.bundleIdentifier).toBe('dev.extensionjs.My-Cool-Extension')
    expect(config.projectLocation).toBe(`${distDir}-xcode`)
    expect(config.macOsOnly).toBe(true)
    expect(config.open).toBe(true)
  })

  it('honors a user-provided bundle id over the derived one', () => {
    writeManifest(distDir, {name: 'My Cool Extension', version: '1.0.0'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari',
      bundleId: 'com.example.mine'
    } as any)

    expect(config.bundleIdentifier).toBe('com.example.mine')
    expect(config.bundleIdDerived).toBe(false)
  })

  it('marks the derived bundle id so the pipeline can hint --bundle-id', () => {
    writeManifest(distDir, {name: 'My Cool Extension', version: '1.0.0'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari'
    } as any)

    expect(config.bundleIdDerived).toBe(true)
  })

  it('validates bundle identifiers as reverse-DNS', () => {
    expect(isValidBundleId('com.example.my-extension')).toBe(true)
    expect(isValidBundleId('dev.extensionjs.My-Cool-Extension')).toBe(true)
    expect(isValidBundleId('single-segment')).toBe(false)
    expect(isValidBundleId('com..double-dot')).toBe(false)
    expect(isValidBundleId('com.1starts-with-digit')).toBe(false)
    expect(isValidBundleId('com.example.')).toBe(false)
    expect(isValidBundleId('')).toBe(false)
  })

  it('falls back to a default app name when the manifest has none', () => {
    writeManifest(distDir, {version: '1.0.0'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'webkit-based'
    } as any)
    expect(config.appName).toBe('Extension')
    expect(config.bundleIdentifier).toBe('dev.extensionjs.Extension')
  })

  it('respects noOpen by disabling the open step', () => {
    writeManifest(distDir, {name: 'NoOpen'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari',
      noOpen: true
    } as any)
    expect(config.open).toBe(false)
  })

  it('composes converter args for xcrun', () => {
    writeManifest(distDir, {name: 'Args Demo'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari'
    } as any)
    const args = composeConverterArgs(config)

    expect(args[0]).toBe('safari-web-extension-converter')
    expect(args).toContain(distDir)
    expect(args).toContain('--project-location')
    expect(args).toContain(`${distDir}-xcode`)
    expect(args).toContain('--app-name')
    expect(args).toContain('Args Demo')
    expect(args).toContain('--bundle-identifier')
    expect(args).toContain('--no-prompt')
    expect(args).toContain('--no-open')
    expect(args).toContain('--force')
    expect(args).toContain('--swift')
    expect(args).toContain('--macos-only')
  })

  it('composes xcodebuild args with ad-hoc signing and the macos-only scheme', () => {
    writeManifest(distDir, {name: 'Build Me'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari'
    } as any)
    const args = composeXcodebuildArgs(config)

    // --macos-only → single scheme named after the app (no " (macOS)" suffix).
    expect(macOsSchemeName(config)).toBe('Build Me')
    expect(args).toContain('-scheme')
    expect(args).toContain('Build Me')
    expect(args).toContain('-project')
    expect(args).toContain(xcodeProjectPath(config))
    // Ad-hoc signing so the embedded .appex passes ValidateEmbeddedBinary.
    expect(args).toContain('CODE_SIGN_IDENTITY=-')
    expect(args).toContain('CODE_SIGNING_ALLOWED=YES')
    expect(args).not.toContain('CODE_SIGNING_ALLOWED=NO')
    expect(args).toContain('build')
    expect(builtAppPath(config)).toMatch(/Build Me\.app$/)
  })
})

describe('run-safari toolchain', () => {
  const original = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: original})
  })

  it('reports macOS based on process.platform', () => {
    Object.defineProperty(process, 'platform', {value: 'darwin'})
    expect(isMacOS()).toBe(true)
    Object.defineProperty(process, 'platform', {value: 'linux'})
    expect(isMacOS()).toBe(false)
  })

  it('returns no toolchain on non-macOS platforms', () => {
    Object.defineProperty(process, 'platform', {value: 'linux'})
    const toolchain = detectSafariToolchain()
    expect(toolchain.platformOk).toBe(false)
    expect(toolchain.needsFullXcode).toBe(false)
    expect(toolchain.ok).toBe(false)
    expect(toolchain.converter).toBeNull()
    expect(toolchain.xcodebuild).toBeNull()
  })
})

describe('run-safari messages', () => {
  it('flags non-macOS platforms with actionable alternatives', () => {
    const msg = messages.safariRequiresMacOS('linux')
    expect(msg).toMatch(/only be built on macOS/)
    expect(msg).toMatch(/Linux/)
    expect(msg).toMatch(/--browser/)
  })

  it('reassures the dist is intact when packaging is skipped off-macOS', () => {
    const msg = messages.safariPackagingSkippedNonMac('win32')
    expect(msg).toMatch(/skipped/)
    expect(msg).toMatch(/Windows/)
    expect(msg).toMatch(/dist\/safari/)
    expect(msg).toMatch(/still complete/)
  })

  it('reports a failed packaging tool with exit code and output tail', () => {
    const msg = messages.safariToolFailed('xcodebuild', 65, 'error: signing')
    expect(msg).toMatch(/xcodebuild/)
    expect(msg).toMatch(/exit 65/)
    expect(msg).toMatch(/error: signing/)
  })

  it('notes when a failed tool produced no output', () => {
    const msg = messages.safariToolFailed('xcrun', null, '   ')
    expect(msg).toMatch(/no exit code/)
    expect(msg).toMatch(/no output captured/)
  })

  it('lists converter compatibility warnings', () => {
    const msg = messages.safariConverterWarnings([
      'Warning: persistent background pages are not supported'
    ])
    expect(msg).toMatch(/1/)
    expect(msg).toMatch(/persistent background pages/)
  })

  it('hints how to launch and enable the app when not opening it', () => {
    const msg = messages.safariOpenHint('/tmp/My App.app', 'My App')
    expect(msg).toMatch(/open/)
    expect(msg).toMatch(/My App\.app/)
    expect(msg).toMatch(/Allow Unsigned Extensions/)
  })

  it('guides installing the full Xcode app when only CLT is active', () => {
    const msg = messages.safariXcodeRequired(
      '/Library/Developer/CommandLineTools'
    )
    expect(msg).toMatch(/full Xcode app/)
    expect(msg).toMatch(/safari-web-extension-converter/)
    expect(msg).toMatch(/xcode-select --switch/)
    expect(msg).toMatch(/CommandLineTools/)
  })

  it('handles a missing developer directory', () => {
    const msg = messages.safariXcodeRequired(null)
    expect(msg).toMatch(/No active developer directory/)
  })

  it('reports a broken Xcode install when a tool is absent', () => {
    const msg = messages.safariToolchainMissing('xcodebuild')
    expect(msg).toMatch(/tool not found/)
    expect(msg).toMatch(/xcodebuild/)
  })

  it('guides the one-time Safari enable steps', () => {
    const msg = messages.safariNextSteps('React Sidebar Example')
    expect(msg).toMatch(/Allow Unsigned Extensions/)
    expect(msg).toMatch(/Settings ▸ Extensions/)
    expect(msg).toMatch(/React Sidebar Example/)
  })
})

describe('run-safari preflight', () => {
  const original = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: original})
  })

  it('returns a fail-fast message on non-macOS (no toolchain spawn needed)', () => {
    Object.defineProperty(process, 'platform', {value: 'linux'})
    const issue = safariPreflightError()
    expect(issue).toBeTruthy()
    expect(String(issue)).toMatch(/only be built on macOS/)
  })

  it('build preflight downgrades non-macOS to a warn-and-skip', () => {
    Object.defineProperty(process, 'platform', {value: 'linux'})
    const preflight = safariBuildPreflight()
    expect(preflight.severity).toBe('skip')
    expect(String(preflight.message)).toMatch(/dist\/safari/)
  })
})

describe('tool output tail', () => {
  it('keeps only the last lines and drops blank ones', () => {
    const output = Array.from({length: 200}, (_, i) => `line ${i}`)
      .join('\n\n')
      .concat('\n')
    const tail = toolOutputTail(output)
    expect(tail).toContain('line 199')
    expect(tail).not.toContain('line 100')
    expect(tail.split('\n').length).toBeLessThanOrEqual(50)
  })

  it('caps pathological single-line output by bytes', () => {
    const tail = toolOutputTail('x'.repeat(1024 * 1024))
    expect(tail.length).toBeLessThanOrEqual(8 * 1024)
  })
})

describe('launchBrowser safari boundary', () => {
  // Safari is a build-only target packaged via packageSafariExtension; there is
  // no live browser session to launch into, so launchBrowser rejects it (the
  // CLI guards dev/preview/start before they ever reach here).
  it('reports safari/webkit-based as unsupported for launching', async () => {
    for (const browser of ['safari', 'webkit-based'] as const) {
      await expect(
        launchBrowser({
          browser,
          outputPath: '/tmp/x',
          contextDir: '/tmp/x',
          extensionsToLoad: ['/tmp/x'],
          dryRun: true
        })
      ).rejects.toThrow(/Unsupported browser/)
    }
  })
})

// ---------------------------------------------------------------------------
// Manifest fingerprinting — staleness detection
// ---------------------------------------------------------------------------

describe('manifest fingerprinting', () => {
  let distDir: string

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-fp-'))
  })
  afterEach(() => {
    try {
      fs.rmSync(distDir, {recursive: true, force: true})
      fs.rmSync(`${distDir}-xcode`, {recursive: true, force: true})
    } catch {}
  })

  function configFor(dir: string) {
    return resolveSafariBuildConfig(makeCompilation(dir), {
      extension: [dir],
      browser: 'safari'
    } as any)
  }

  it('reports stale when no fingerprint has been saved yet', () => {
    writeManifest(distDir, {name: 'Fresh', manifest_version: 3})
    const config = configFor(distDir)
    expect(isProjectStale(config)).toBe(true)
  })

  it('reports NOT stale after fingerprint is saved with unchanged manifest', () => {
    writeManifest(distDir, {name: 'Stable', permissions: ['storage']})
    const config = configFor(distDir)
    saveManifestFingerprint(config)
    expect(isProjectStale(config)).toBe(false)
  })

  it('reports stale when the bundle id changes (identity in fingerprint)', () => {
    writeManifest(distDir, {name: 'Identity', manifest_version: 3})
    const config = configFor(distDir)
    saveManifestFingerprint(config)
    expect(isProjectStale(config)).toBe(false)

    const rebranded = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari',
      bundleId: 'com.example.identity'
    } as any)
    expect(isProjectStale(rebranded)).toBe(true)
  })

  it('reports stale when the app name changes (identity in fingerprint)', () => {
    writeManifest(distDir, {name: 'Identity', manifest_version: 3})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    const renamed = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari',
      appName: 'Renamed App'
    } as any)
    expect(isProjectStale(renamed)).toBe(true)
  })

  it('treats a v1 (manifest-only) fingerprint as stale so it migrates once', () => {
    writeManifest(distDir, {name: 'Legacy', manifest_version: 3})
    const config = configFor(distDir)

    // v1 files stored the normalized manifest string with no JSON envelope.
    fs.mkdirSync(path.dirname(manifestFingerprintPath(config)), {
      recursive: true
    })
    fs.writeFileSync(
      manifestFingerprintPath(config),
      '{"manifest_version":3,"name":"Legacy"}',
      'utf8'
    )

    expect(isProjectStale(config)).toBe(true)
    saveManifestFingerprint(config)
    expect(isProjectStale(config)).toBe(false)
  })

  it('reports stale when permissions change', () => {
    writeManifest(distDir, {name: 'Evolving', permissions: ['storage']})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    // Simulate a manifest edit — add a new permission
    writeManifest(distDir, {
      name: 'Evolving',
      permissions: ['storage', 'tabs']
    })
    expect(isProjectStale(config)).toBe(true)
  })

  it('reports stale when icons change', () => {
    writeManifest(distDir, {name: 'Icons', icons: {'48': 'icon48.png'}})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    writeManifest(distDir, {
      name: 'Icons',
      icons: {'48': 'icon48.png', '128': 'icon128.png'}
    })
    expect(isProjectStale(config)).toBe(true)
  })

  it('ignores whitespace-only manifest formatting differences', () => {
    const manifest = {name: 'Whitespace', permissions: ['activeTab']}
    fs.mkdirSync(distDir, {recursive: true})
    // Write with compact formatting
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify(manifest)
    )
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    // Rewrite with pretty formatting — same content, different whitespace
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )
    expect(isProjectStale(config)).toBe(false)
  })

  it('is not confused by key reordering in the manifest', () => {
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify({name: 'Order', permissions: ['storage']})
    )
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify({permissions: ['storage'], name: 'Order'})
    )
    expect(isProjectStale(config)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Xcode user-settings preservation
// ---------------------------------------------------------------------------

describe('xcode user-settings preservation', () => {
  const SAMPLE_PBXPROJ = [
    '/* Begin XCBuildConfiguration section */',
    '  AAA /* Debug */ = {',
    '    isa = XCBuildConfiguration;',
    '    buildSettings = {',
    '      PRODUCT_NAME = "$(TARGET_NAME)";',
    '      DEVELOPMENT_TEAM = ABCDE12345;',
    '      CODE_SIGN_STYLE = Automatic;',
    '    };',
    '    name = Debug;',
    '  };',
    '  BBB /* Release */ = {',
    '    isa = XCBuildConfiguration;',
    '    buildSettings = {',
    '      PRODUCT_NAME = "$(TARGET_NAME)";',
    '      DEVELOPMENT_TEAM = ABCDE12345;',
    '      CODE_SIGN_STYLE = Automatic;',
    '    };',
    '    name = Release;',
    '  };',
    '/* End XCBuildConfiguration section */'
  ].join('\n')

  it('extracts DEVELOPMENT_TEAM and CODE_SIGN_STYLE from a pbxproj', () => {
    const settings = extractXcodeUserSettings(SAMPLE_PBXPROJ)
    expect(settings.DEVELOPMENT_TEAM).toBe('ABCDE12345')
    expect(settings.CODE_SIGN_STYLE).toBe('Automatic')
  })

  it('returns no settings when the pbxproj has none configured', () => {
    const bare = [
      'buildSettings = {',
      '  PRODUCT_NAME = "$(TARGET_NAME)";',
      '};'
    ].join('\n')
    const settings = extractXcodeUserSettings(bare)
    expect(Object.keys(settings)).toHaveLength(0)
  })

  it('applies saved settings into a fresh pbxproj that lacks them', () => {
    const fresh = [
      '  buildSettings = {',
      '    PRODUCT_NAME = "$(TARGET_NAME)";',
      '  };'
    ].join('\n')
    const result = applyXcodeUserSettings(fresh, {
      DEVELOPMENT_TEAM: 'TEAM99',
      CODE_SIGN_STYLE: 'Manual'
    })
    expect(result).toContain('DEVELOPMENT_TEAM = TEAM99;')
    expect(result).toContain('CODE_SIGN_STYLE = Manual;')
  })

  it('replaces existing settings with the preserved values', () => {
    const existing = [
      '  buildSettings = {',
      '    DEVELOPMENT_TEAM = "";',
      '    CODE_SIGN_STYLE = Manual;',
      '  };'
    ].join('\n')
    const result = applyXcodeUserSettings(existing, {
      DEVELOPMENT_TEAM: 'MYTEAM',
      CODE_SIGN_STYLE: 'Automatic'
    })
    expect(result).toContain('DEVELOPMENT_TEAM = MYTEAM;')
    expect(result).toContain('CODE_SIGN_STYLE = Automatic;')
    // The old values should be gone
    expect(result).not.toMatch(/DEVELOPMENT_TEAM = "";/)
    expect(result).not.toMatch(/CODE_SIGN_STYLE = Manual;/)
  })
})

// ---------------------------------------------------------------------------
// Full pipeline staleness integration (faked converter + xcodebuild)
// ---------------------------------------------------------------------------

describe('safari pipeline staleness integration', () => {
  let distDir: string
  let xcodeDir: string
  let converterCalls: string[][]
  let xcodebuildCalls: string[][]

  function configFor(dir: string) {
    return resolveSafariBuildConfig(makeCompilation(dir), {
      extension: [dir],
      browser: 'safari'
    } as any)
  }

  // Simulates what the converter would produce: the .xcodeproj directory and
  // a project.pbxproj inside it.
  function fakeConvert(config: ReturnType<typeof configFor>) {
    const projDir = xcodeProjectPath(config)
    fs.mkdirSync(projDir, {recursive: true})
    fs.writeFileSync(
      path.join(projDir, 'project.pbxproj'),
      [
        'buildSettings = {',
        '  PRODUCT_NAME = "$(TARGET_NAME)";',
        '};'
      ].join('\n')
    )
  }

  // Simulates what the converter produces when the user has already configured
  // signing in Xcode (i.e. the pbxproj has DEVELOPMENT_TEAM).
  function fakeConvertWithTeam(
    config: ReturnType<typeof configFor>,
    team: string
  ) {
    const projDir = xcodeProjectPath(config)
    fs.mkdirSync(projDir, {recursive: true})
    fs.writeFileSync(
      path.join(projDir, 'project.pbxproj'),
      [
        'buildSettings = {',
        `  DEVELOPMENT_TEAM = ${team};`,
        '  PRODUCT_NAME = "$(TARGET_NAME)";',
        '};'
      ].join('\n')
    )
  }

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-pipe-'))
    xcodeDir = `${distDir}-xcode`
    converterCalls = []
    xcodebuildCalls = []
  })

  afterEach(() => {
    try {
      fs.rmSync(distDir, {recursive: true, force: true})
      fs.rmSync(xcodeDir, {recursive: true, force: true})
    } catch {}
  })

  // A minimal pipeline runner that records tool invocations instead of
  // shelling out to xcrun / xcodebuild, so the tests work on any OS.
  async function runFakePipeline(
    manifest: Record<string, unknown>,
    opts?: {
      existingTeam?: string
      converterProduces?: (
        config: ReturnType<typeof configFor>
      ) => void
    }
  ): Promise<{logs: string[]}> {
    writeManifest(distDir, manifest)
    const config = configFor(distDir)
    const logs: string[] = []
    const logger = {
      info: (m: string) => logs.push(m),
      warn: (m: string) => logs.push(m),
      error: (m: string) => logs.push(m),
      debug: () => {}
    }

    const projectExists = fs.existsSync(xcodeProjectPath(config))
    const needsConversion = !projectExists || isProjectStale(config)

    if (needsConversion) {
      if (projectExists) {
        logs.push('[stale]')
      }

      const {saved, restore} = backupAndRestoreXcodeSettings(config)

      // "Run" the converter (fake).
      converterCalls.push(composeConverterArgs(config))

      // Simulate the converter writing a fresh project.
      const produceFn =
        opts?.converterProduces || ((c: ReturnType<typeof configFor>) => fakeConvert(c))
      produceFn(config)

      restore()

      const keys = Object.keys(saved)
      if (keys.length > 0) {
        logs.push(`[preserved:${keys.join(',')}]`)
      }

      saveManifestFingerprint(config)
      logs.push('[converted]')
    } else {
      logs.push('[skipped-conversion]')
    }

    // Always "run" xcodebuild (fake).
    xcodebuildCalls.push(composeXcodebuildArgs(config))
    logs.push('[built]')

    return {logs}
  }

  it('resource-only change: skips the converter, still runs xcodebuild', async () => {
    // First build: full conversion
    const manifest = {
      name: 'MyExt',
      permissions: ['storage'],
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    }
    const first = await runFakePipeline(manifest)
    expect(first.logs).toContain('[converted]')
    expect(first.logs).toContain('[built]')
    expect(converterCalls).toHaveLength(1)

    // Now simulate editing content.js (manifest unchanged).
    // Just re-run the pipeline with the same manifest.
    const second = await runFakePipeline(manifest)
    expect(second.logs).toContain('[skipped-conversion]')
    expect(second.logs).toContain('[built]')
    // Converter was NOT called again
    expect(converterCalls).toHaveLength(1)
    // xcodebuild was called both times
    expect(xcodebuildCalls).toHaveLength(2)
  })

  it('manifest change: triggers the converter', async () => {
    // First build
    await runFakePipeline({name: 'MyExt', permissions: ['storage']})
    expect(converterCalls).toHaveLength(1)

    // Second build with a permission added
    const second = await runFakePipeline({
      name: 'MyExt',
      permissions: ['storage', 'tabs']
    })
    expect(second.logs).toContain('[stale]')
    expect(second.logs).toContain('[converted]')
    expect(converterCalls).toHaveLength(2)
  })

  it('user Xcode configuration survives regeneration', async () => {
    // First build — creates the project
    await runFakePipeline({name: 'SignedExt', permissions: ['storage']})

    // Simulate the user configuring a signing team in Xcode by rewriting the
    // pbxproj with DEVELOPMENT_TEAM set.
    const config = configFor(distDir)
    const projFile = pbxprojPath(config)
    fs.writeFileSync(
      projFile,
      [
        'buildSettings = {',
        '  DEVELOPMENT_TEAM = USERTEAM42;',
        '  CODE_SIGN_STYLE = Automatic;',
        '  PRODUCT_NAME = "$(TARGET_NAME)";',
        '};'
      ].join('\n')
    )

    // Now change the manifest (triggers regeneration).
    const result = await runFakePipeline({
      name: 'SignedExt',
      permissions: ['storage', 'activeTab']
    })

    expect(result.logs).toContain('[stale]')
    expect(result.logs).toContain('[converted]')
    expect(result.logs).toContain(
      '[preserved:DEVELOPMENT_TEAM,CODE_SIGN_STYLE]'
    )

    // Verify the regenerated pbxproj has the user's team restored.
    const regenerated = fs.readFileSync(projFile, 'utf8')
    expect(regenerated).toContain('DEVELOPMENT_TEAM = USERTEAM42;')
    expect(regenerated).toContain('CODE_SIGN_STYLE = Automatic;')
  })

  it('first build (no prior project) runs the converter without a stale warning', async () => {
    const result = await runFakePipeline({
      name: 'BrandNew',
      permissions: []
    })
    expect(result.logs).toContain('[converted]')
    expect(result.logs).not.toContain('[stale]')
    expect(result.logs).toContain('[built]')
  })

  it('icon change in the manifest triggers regeneration', async () => {
    await runFakePipeline({
      name: 'Icons',
      icons: {'48': 'icon48.png'}
    })
    expect(converterCalls).toHaveLength(1)

    const second = await runFakePipeline({
      name: 'Icons',
      icons: {'48': 'icon48.png', '128': 'icon128.png'}
    })
    expect(second.logs).toContain('[stale]')
    expect(second.logs).toContain('[converted]')
    expect(converterCalls).toHaveLength(2)
  })
})
