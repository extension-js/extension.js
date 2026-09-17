import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {prefix} from '../../helpers/messaging'
import * as messages from '../browsers-lib/messages'
import {launchBrowser} from '../index'
import {
  converterWarnings,
  packageSafariExtension,
  type SafariPipelineMode,
  safariBuildPreflight,
  safariPreflightError,
  toolOutputTail
} from '../run-safari/safari-launch'
import {
  alignBundleIdentifiers,
  applyXcodeUserSettings,
  backupAndRestoreXcodeSettings,
  builtAppPath,
  composeConverterArgs,
  composeXcodebuildArgs,
  extractXcodeUserSettings,
  isProjectStale,
  isValidBundleId,
  macOsSchemeName,
  manifestFingerprintPath,
  PRESERVED_SETTINGS,
  pbxprojPath,
  resolveSafariBuildConfig,
  saveManifestFingerprint,
  xcodeProjectPath
} from '../run-safari/safari-launch/safari-config'
import {
  detectSafariToolchain,
  isMacOS
} from '../run-safari/safari-launch/toolchain'
import {type FakeSafariTools, fakeSafariTools} from './safari-fake-tools'

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
    } catch {
      // Ignore
    }
  })

  it('derives app name and a converter-aligned bundle id from the manifest', () => {
    writeManifest(distDir, {name: 'My Cool Extension', version: '1.0.0'})
    const config = resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari'
    } as any)

    expect(config.appName).toBe('My Cool Extension')
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

  it('aligns app and appex PRODUCT_BUNDLE_IDENTIFIERs to the configured id', () => {
    const pbxproj = [
      'buildSettings = {',
      '  PRODUCT_BUNDLE_IDENTIFIER = "com.example.safari-smoke.Extension";',
      '};',
      'buildSettings = {',
      '  PRODUCT_BUNDLE_IDENTIFIER = "com.example.Safari-Smoke";',
      '};',
      'buildSettings = {',
      '  PRODUCT_BUNDLE_IDENTIFIER = dev.extensionjs.Unquoted;',
      '};'
    ].join('\n')

    const aligned = alignBundleIdentifiers(pbxproj, 'com.example.safari-smoke')

    expect(aligned).toContain(
      'PRODUCT_BUNDLE_IDENTIFIER = "com.example.safari-smoke.Extension";'
    )

    expect(aligned).not.toContain('Safari-Smoke')
    expect(aligned).not.toContain('Unquoted')
    const appIds = aligned.match(
      /PRODUCT_BUNDLE_IDENTIFIER = "com\.example\.safari-smoke";/g
    )
    expect(appIds).toHaveLength(2)
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

    expect(macOsSchemeName(config)).toBe('Build Me')
    expect(args).toContain('-scheme')
    expect(args).toContain('Build Me')
    expect(args).toContain('-project')
    expect(args).toContain(xcodeProjectPath(config))
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

  it('says which flagged keys the build keeps on purpose', () => {
    const msg = messages.safariConverterWarnings([
      'Warning: The following keys in your manifest.json are not supported:',
      'world'
    ])
    expect(msg).toMatch(/on purpose/)
    expect(msg).toMatch(/Safari 18/)
  })

  it('adds no kept-on-purpose line when every flagged key was dropped', () => {
    const msg = messages.safariConverterWarnings([
      'Warning: The following keys in your manifest.json are not supported:',
      'side_panel'
    ])
    expect(msg).not.toMatch(/on purpose/)
  })

  it('warns loudly about what regeneration discards and preserves', () => {
    const msg = messages.safariRegenerationDiscards([
      'DEVELOPMENT_TEAM',
      'CODE_SIGN_STYLE'
    ])
    expect(msg).toMatch(/discarded/)
    expect(msg).toMatch(/entitlements/)
    expect(msg).toMatch(/DEVELOPMENT_TEAM, CODE_SIGN_STYLE/)
  })

  it('distinguishes forced regeneration from staleness', () => {
    expect(messages.safariForcedRegeneration()).toMatch(/--force-regenerate/)
    expect(messages.safariProjectStale()).toMatch(/identity options/)
  })

  it('hints how to launch and enable the app when not opening it', () => {
    const msg = messages.safariOpenHint('/tmp/My App.app', 'My App')
    expect(msg).toMatch(/open/)
    expect(msg).toMatch(/My App\.app/)
    expect(msg).not.toMatch(/Allow Unsigned Extensions/)
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
    expect(msg).toMatch(/Can't find the Safari packaging tool\./)
    expect(msg).toMatch(/NOT FOUND/)
    expect(msg).toMatch(/xcodebuild/)
  })

  it('guides the one-time Safari enable steps', () => {
    const msg = messages.safariNextSteps('React Sidebar Example')
    expect(msg).not.toMatch(/Allow Unsigned Extensions/)
    expect(msg).toMatch(/Settings ▸ Extensions/)
    expect(msg).toMatch(/React Sidebar Example/)
  })

  it('renders the derived bundle id as one info line naming --bundle-id', () => {
    const msg = messages.safariDefaultBundleIdNote('dev.extensionjs.My-App')
    expect(msg.startsWith(prefix('info'))).toBe(true)
    expect(msg).toMatch(/dev\.extensionjs\.My-App/)
    expect(msg).toMatch(/generated/)
    expect(msg).toMatch(/--bundle-id/)
    expect(msg).not.toContain('\n')
    expect(msg).not.toMatch(/Apple/)
  })

  it('keeps the registration miss no louder than the identity warning', () => {
    const msg = messages.safariNotYetRegistered('My App')
    expect(msg.startsWith(prefix('info'))).toBe(true)
    expect(msg).toMatch(/Open the app once/)
  })
})

describe('derived bundle id note timing', () => {
  let distDir: string

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-warn-'))
    writeManifest(distDir, {name: 'Warn Demo', version: '1.0.0'})
  })

  afterEach(() => {
    try {
      fs.rmSync(distDir, {recursive: true, force: true})
      fs.rmSync(`${distDir}-xcode`, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function channelLogger(tools: FakeSafariTools) {
    const warns: string[] = []
    const infos: string[] = []

    return {
      logger: {
        info: (m: string) => {
          infos.push(String(m))
          tools.events.push('info')
        },
        warn: (m: string) => {
          warns.push(String(m))
          tools.events.push('warn')
        },
        error: () => {},
        debug: () => {}
      } as any,
      warns,
      infos
    }
  }

  it('reports the derived bundle id once when the full package completes', async () => {
    const tools = fakeSafariTools()
    const {logger, warns, infos} = channelLogger(tools)
    await packageSafariExtension(
      {extension: [distDir], browser: 'safari', noOpen: true, tools} as any,
      distDir,
      logger,
      'full'
    )

    const notes = infos.filter((line) => /--bundle-id/.test(line))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toBe(
      messages.safariDefaultBundleIdNote('dev.extensionjs.Warn-Demo')
    )

    expect(warns).toHaveLength(0)

    // The note closes the package: it is the last line, printed after every
    // tool has run, not a warning ahead of the converter.
    expect(infos[infos.length - 1]).toBe(notes[0])
    expect(tools.events[tools.events.length - 1]).toBe('info')
    expect(tools.events.indexOf('xcodebuild')).toBeLessThan(
      tools.events.lastIndexOf('info')
    )
  })

  it('stays silent when the user supplies their own bundle id', async () => {
    const tools = fakeSafariTools()
    const {logger, warns, infos} = channelLogger(tools)
    await packageSafariExtension(
      {
        extension: [distDir],
        browser: 'safari',
        bundleId: 'com.example.mine',
        noOpen: true,
        tools
      } as any,
      distDir,
      logger,
      'full'
    )

    expect(warns).toHaveLength(0)
    expect(infos.some((line) => /--bundle-id/.test(line))).toBe(false)
    expect(tools.calls.converter).toHaveLength(1)
  })

  it('does not repeat the note on resync rebuilds', async () => {
    const tools = fakeSafariTools()
    const {logger, warns, infos} = channelLogger(tools)
    await packageSafariExtension(
      {extension: [distDir], browser: 'safari', tools} as any,
      distDir,
      logger,
      'resync'
    )

    expect(warns).toHaveLength(0)
    expect(infos.some((line) => /--bundle-id/.test(line))).toBe(false)
    expect(tools.calls.xcodebuild).toHaveLength(1)
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

describe('manifest fingerprinting', () => {
  let distDir: string

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-fp-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(distDir, {recursive: true, force: true})
      fs.rmSync(`${distDir}-xcode`, {recursive: true, force: true})
    } catch {
      // Ignore
    }
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

  it('ignores the hot update folder the dev runtime adds on the first save', () => {
    writeManifest(distDir, {name: 'Hot', manifest_version: 3})
    const config = configFor(distDir)
    saveManifestFingerprint(config)
    fs.mkdirSync(path.join(distDir, 'hot'), {recursive: true})

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

  // The converter reads every permission string and rejects the ones Safari has
  // no API for, so a permission edit changes the verdict and has to reconvert.
  it('reports stale when a permission appears', () => {
    writeManifest(distDir, {name: 'Evolving', permissions: ['storage']})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    writeManifest(distDir, {
      name: 'Evolving',
      permissions: ['storage', 'tabs']
    })

    expect(isProjectStale(config)).toBe(true)
  })

  it('reports stale when a rejected permission appears, then when it goes', () => {
    writeManifest(distDir, {name: 'Sidebar', permissions: ['storage']})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    // sidePanel is one of the 55 permissions the webkit filter drops.
    writeManifest(distDir, {
      name: 'Sidebar',
      permissions: ['storage', 'sidePanel']
    })

    expect(isProjectStale(config)).toBe(true)
    saveManifestFingerprint(config)

    writeManifest(distDir, {name: 'Sidebar', permissions: ['storage']})
    expect(isProjectStale(config)).toBe(true)
  })

  it('reports stale when a rejected optional permission appears', () => {
    writeManifest(distDir, {name: 'Optional', optional_permissions: ['tabs']})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    writeManifest(distDir, {
      name: 'Optional',
      optional_permissions: ['tabs', 'management']
    })

    expect(isProjectStale(config)).toBe(true)
  })

  it('reports stale when a rejected top-level key appears, then when it goes', () => {
    writeManifest(distDir, {name: 'Panel', manifest_version: 3})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    // side_panel is one of the 17 top-level keys the webkit filter drops.
    writeManifest(distDir, {
      name: 'Panel',
      manifest_version: 3,
      side_panel: {default_path: 'sidebar.html'}
    })

    expect(isProjectStale(config)).toBe(true)
    saveManifestFingerprint(config)

    writeManifest(distDir, {name: 'Panel', manifest_version: 3})
    expect(isProjectStale(config)).toBe(true)
  })

  it('reports stale when options_ui.open_in_tab appears', () => {
    writeManifest(distDir, {
      name: 'Options',
      options_ui: {page: 'options.html'}
    })

    const config = configFor(distDir)
    saveManifestFingerprint(config)

    writeManifest(distDir, {
      name: 'Options',
      options_ui: {page: 'options.html', open_in_tab: true}
    })

    expect(isProjectStale(config)).toBe(true)
  })

  // The converter never reads these, so reconverting for them would buy an
  // 11 second pause and no fresher verdict.
  it('ignores a benign manifest edit the converter never judges', () => {
    writeManifest(distDir, {
      name: 'Benign',
      version: '1.0.0',
      description: 'First wording',
      permissions: ['storage']
    })

    const config = configFor(distDir)
    saveManifestFingerprint(config)

    writeManifest(distDir, {
      name: 'Benign',
      version: '1.0.1',
      description: 'Second wording, same keys',
      permissions: ['storage']
    })

    expect(isProjectStale(config)).toBe(false)
  })

  // Dev renames content scripts on every edit (content-0.<hash>.js), which used
  // to read as a new project and re-ran the converter on every single save.
  it('ignores a content-script rename inside an entry it already references', () => {
    writeManifest(distDir, {name: 'Hashed'})
    fs.mkdirSync(path.join(distDir, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'content_scripts', 'content-0.aaa.js'),
      ''
    )

    const config = configFor(distDir)
    saveManifestFingerprint(config)

    fs.rmSync(path.join(distDir, 'content_scripts', 'content-0.aaa.js'))
    fs.writeFileSync(
      path.join(distDir, 'content_scripts', 'content-0.bbb.js'),
      ''
    )

    expect(isProjectStale(config)).toBe(false)
  })

  it('reports stale when a new top-level entry appears', () => {
    writeManifest(distDir, {name: 'Growing'})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    fs.mkdirSync(path.join(distDir, 'devtools'), {recursive: true})
    expect(isProjectStale(config)).toBe(true)
  })

  it('reports stale when an older fingerprint shape is on disk', () => {
    writeManifest(distDir, {name: 'Migrating'})
    const config = configFor(distDir)
    saveManifestFingerprint(config)

    fs.writeFileSync(
      manifestFingerprintPath(config),
      JSON.stringify({v: 2, identity: {}, manifest: '{}'})
    )

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
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify(manifest)
    )

    const config = configFor(distDir)
    saveManifestFingerprint(config)

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

  // The rename dev does on every save happens INSIDE the manifest too, since the
  // emitted content_scripts[].js points at the hashed name. The judged shape is
  // key names here, never paths, so the save that used to cost 11 seconds of
  // converter still costs none.
  it('ignores a content-script rename written into the manifest itself', () => {
    writeManifest(distDir, {
      name: 'Hashed',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.aaa.js']}
      ]
    })

    const config = configFor(distDir)
    saveManifestFingerprint(config)

    writeManifest(distDir, {
      name: 'Hashed',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.bbb.js']}
      ]
    })

    expect(isProjectStale(config)).toBe(false)
  })

  it('reports stale when a v3 fingerprint is on disk, then migrates once', () => {
    writeManifest(distDir, {name: 'Migrating', permissions: ['storage']})
    const config = configFor(distDir)

    // A v3 fingerprint of this very manifest: same identity, same entries, same
    // icons, and no record at all of what the converter judges.
    fs.mkdirSync(path.dirname(manifestFingerprintPath(config)), {
      recursive: true
    })

    fs.writeFileSync(
      manifestFingerprintPath(config),
      JSON.stringify({
        v: 3,
        identity: {
          appName: 'Migrating',
          bundleId: 'dev.extensionjs.Migrating',
          macOsOnly: true
        },
        entries: ['manifest.json'],
        icons: ''
      }),
      'utf8'
    )

    expect(isProjectStale(config)).toBe(true)
    saveManifestFingerprint(config)
    expect(isProjectStale(config)).toBe(false)
  })
})

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
    expect(result).not.toMatch(/DEVELOPMENT_TEAM = "";/)
    expect(result).not.toMatch(/CODE_SIGN_STYLE = Manual;/)
  })
})

// The production pipeline, driven end to end through the injected tool host:
// the only things faked are the processes (converter, xcodebuild, open, the
// pid lookup, pluginkit). Every branch, message and ready.json write is real.
describe('safari pipeline through the injected tool host', () => {
  let root: string
  let distDir: string
  let readyPath: string

  const manifest = {
    name: 'MyExt',
    permissions: ['storage'],
    content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
  }

  function configFor(extra: Record<string, unknown> = {}) {
    return resolveSafariBuildConfig(makeCompilation(distDir), {
      extension: [distDir],
      browser: 'safari',
      ...extra
    } as any)
  }

  function collectingLogger(tools: FakeSafariTools, logs: string[]) {
    const record = (m: unknown) => {
      tools.events.push(`log:${logs.length}`)
      logs.push(String(m))
    }

    return {info: record, warn: record, error: record, debug: () => {}}
  }

  async function runPipeline(
    input: Record<string, unknown>,
    opts: {
      tools?: FakeSafariTools
      mode?: SafariPipelineMode
      host?: Record<string, unknown>
      logs?: string[]
    } = {}
  ) {
    writeManifest(distDir, input)
    const tools = opts.tools || fakeSafariTools()
    const logs = opts.logs || []
    const result = await packageSafariExtension(
      {extension: [distDir], browser: 'safari', tools, ...opts.host} as any,
      distDir,
      collectingLogger(tools, logs),
      opts.mode || 'full'
    )

    return {result, logs, tools}
  }

  // Where a log line sits among the tool calls, so a spec can prove a message
  // printed before (or after) a process ran.
  function eventIndexOfLog(
    tools: FakeSafariTools,
    logs: string[],
    line: string
  ) {
    return tools.events.indexOf(`log:${logs.indexOf(line)}`)
  }

  function processEvents(tools: FakeSafariTools) {
    return tools.events.filter((event) => !event.startsWith('log:'))
  }

  function readReady() {
    return JSON.parse(fs.readFileSync(readyPath, 'utf8'))
  }

  function valueAfter(args: string[], flag: string) {
    return args[args.indexOf(flag) + 1]
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-pipe-'))
    distDir = path.join(root, 'dist', 'safari')
    readyPath = path.join(root, 'dist', 'extension-js', 'safari', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'safari', command: 'dev'})
    )
  })

  afterEach(() => {
    try {
      fs.rmSync(root, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  it('first run: converts, builds, opens the app, stamps the pid and confirms registration', async () => {
    const {result, logs, tools} = await runPipeline(manifest)
    const config = configFor()
    const appPath = builtAppPath(config)

    expect(tools.calls.converter).toHaveLength(1)
    const converter = tools.calls.converter[0]
    expect(converter[0]).toBe('safari-web-extension-converter')
    expect(converter[1]).toBe(distDir)
    expect(valueAfter(converter, '--project-location')).toBe(
      config.projectLocation
    )

    expect(valueAfter(converter, '--app-name')).toBe('MyExt')
    expect(valueAfter(converter, '--bundle-identifier')).toBe(
      'dev.extensionjs.MyExt'
    )

    for (const flag of [
      '--no-prompt',
      '--no-open',
      '--force',
      '--swift',
      '--macos-only'
    ]) {
      expect(converter).toContain(flag)
    }

    expect(tools.calls.xcodebuild).toHaveLength(1)
    const xcodebuild = tools.calls.xcodebuild[0]
    expect(valueAfter(xcodebuild, '-project')).toBe(xcodeProjectPath(config))
    expect(valueAfter(xcodebuild, '-scheme')).toBe('MyExt')
    expect(xcodebuild[xcodebuild.length - 1]).toBe('build')

    // The converter derives ids from the app name; the pipeline aligns both
    // targets to the configured identity before xcodebuild reads the project.
    const pbxproj = fs.readFileSync(pbxprojPath(config), 'utf8')
    expect(pbxproj).toContain(
      'PRODUCT_BUNDLE_IDENTIFIER = "dev.extensionjs.MyExt";'
    )

    expect(pbxproj).toContain(
      'PRODUCT_BUNDLE_IDENTIFIER = "dev.extensionjs.MyExt.Extension";'
    )

    expect(pbxproj).not.toContain('com.converter')

    expect(tools.calls.openApp).toEqual([appPath])
    expect(tools.calls.openSafari).toEqual([])
    expect(tools.calls.resolvePid).toEqual(['dev.extensionjs.MyExt'])
    expect(tools.calls.pluginkit).toBe(1)
    expect(processEvents(tools)).toEqual([
      'converter',
      'xcodebuild',
      'openApp',
      'resolvePid',
      'pluginkit'
    ])

    expect(readReady()).toMatchObject({
      status: 'ready',
      browserPid: 4242,
      extensionId: 'dev.extensionjs.MyExt.Extension',
      binary: appPath,
      binaryProvenance: 'system'
    })

    expect(result.appPath).toBe(appPath)
    expect(result.bundleId).toBe('dev.extensionjs.MyExt')
    expect(logs).toContain(messages.safariConverting(distDir))
    expect(logs).toContain(messages.safariConverted(config.projectLocation))
    expect(logs).toContain(messages.safariBuilding('MyExt'))
    expect(logs).toContain(messages.safariBuilt(appPath))
    expect(logs).toContain(messages.safariOpening(appPath))
    expect(logs).toContain(messages.safariNextSteps('MyExt', false))
    expect(logs).toContain(messages.safariRegistered('MyExt'))
    expect(logs).not.toContain(messages.safariProjectStale())
    expect(logs).not.toContain(messages.safariSkippingConversion())
    expect(logs).not.toContain(messages.safariNotYetRegistered('MyExt'))
    expect(
      logs.some((line) => /could not find its process id/.test(line))
    ).toBe(false)

    expect(fs.existsSync(manifestFingerprintPath(config))).toBe(true)
  })

  it('drops --macos-only and switches the scheme when macOsOnly is off', async () => {
    const {tools} = await runPipeline(manifest, {host: {macOsOnly: false}})

    expect(tools.calls.converter[0]).not.toContain('--macos-only')
    expect(valueAfter(tools.calls.xcodebuild[0], '-scheme')).toBe(
      'MyExt (macOS)'
    )
  })

  it('passes the development team through to xcodebuild and says so', async () => {
    const {logs, tools} = await runPipeline(manifest, {
      host: {developmentTeam: 'TEAM123'}
    })

    expect(tools.calls.xcodebuild[0]).toContain('DEVELOPMENT_TEAM=TEAM123')
    expect(logs).toContain(messages.safariNextSteps('MyExt', true))
  })

  it('resync: reuses a fresh project, rebuilds, and neither opens nor mentions skipping', async () => {
    await runPipeline(manifest)
    const tools = fakeSafariTools()
    const {logs} = await runPipeline(manifest, {tools, mode: 'resync'})

    expect(tools.calls.converter).toHaveLength(0)
    expect(tools.calls.xcodebuild).toHaveLength(1)
    expect(tools.calls.openApp).toHaveLength(0)
    expect(tools.calls.resolvePid).toHaveLength(0)
    expect(tools.calls.pluginkit).toBe(0)
    expect(logs).toContain(messages.safariRebuilt('MyExt'))
    expect(logs).not.toContain(messages.safariSkippingConversion())
    expect(logs).not.toContain(messages.safariBuilding('MyExt'))
    expect(logs).not.toContain(messages.safariBuilt(builtAppPath(configFor())))
  })

  it('full mode on a fresh project says the conversion is skipped and still opens', async () => {
    await runPipeline(manifest)
    const tools = fakeSafariTools()
    const {logs} = await runPipeline(manifest, {tools})

    expect(tools.calls.converter).toHaveLength(0)
    expect(tools.calls.xcodebuild).toHaveLength(1)
    expect(tools.calls.openApp).toHaveLength(1)
    expect(logs).toContain(messages.safariSkippingConversion())
    expect(logs).toContain(messages.safariBuilding('MyExt'))
  })

  it('content-script rehash alone: reuses the project', async () => {
    await runPipeline({
      name: 'MyExt',
      content_scripts: [{matches: ['<all_urls>'], js: ['content-0.aaa.js']}]
    })

    const tools = fakeSafariTools()
    const {logs} = await runPipeline(
      {
        name: 'MyExt',
        content_scripts: [{matches: ['<all_urls>'], js: ['content-0.bbb.js']}]
      },
      {tools}
    )

    expect(tools.calls.converter).toHaveLength(0)
    expect(logs).not.toContain(messages.safariProjectStale())
    expect(logs).toContain(messages.safariSkippingConversion())
  })

  it('first resync after the full package: the hot update folder alone reuses the project', async () => {
    const tools = fakeSafariTools()
    await runPipeline(manifest, {tools})

    // The first watch rebuild is the first compile that emits HMR chunks, and
    // they land in a top-level hot/ folder the full package never saw.
    fs.mkdirSync(path.join(distDir, 'hot'), {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'hot', 'main.abc123.hot-update.json'),
      '{"c":["main"],"r":[],"m":[]}'
    )

    const {logs} = await runPipeline(manifest, {tools, mode: 'resync'})

    expect(tools.calls.converter).toHaveLength(1)
    expect(tools.calls.xcodebuild).toHaveLength(2)
    expect(logs).not.toContain(messages.safariProjectStale())
    expect(logs).not.toContain(
      messages.safariRegenerationDiscards([...PRESERVED_SETTINGS])
    )

    expect(logs).toContain(messages.safariRebuilt('MyExt'))
  })

  it('permissions change: converts again and warns about discarded customizations first', async () => {
    await runPipeline({name: 'MyExt', permissions: ['storage']})
    const tools = fakeSafariTools()
    const {logs} = await runPipeline(
      {name: 'MyExt', permissions: ['storage', 'sidePanel']},
      {tools}
    )

    const discards = messages.safariRegenerationDiscards([
      ...PRESERVED_SETTINGS
    ])
    expect(tools.calls.converter).toHaveLength(1)
    expect(logs).toContain(messages.safariProjectStale())
    expect(logs).toContain(discards)
    expect(logs).not.toContain(messages.safariForcedRegeneration())
    expect(eventIndexOfLog(tools, logs, discards)).toBeLessThan(
      tools.events.indexOf('converter')
    )
  })

  it('new top-level entry: converts again', async () => {
    await runPipeline({name: 'MyExt', permissions: ['storage']})
    fs.mkdirSync(path.join(distDir, 'devtools'), {recursive: true})

    const tools = fakeSafariTools()
    const {logs} = await runPipeline(
      {name: 'MyExt', permissions: ['storage']},
      {tools}
    )

    expect(tools.calls.converter).toHaveLength(1)
    expect(logs).toContain(messages.safariProjectStale())
  })

  it('icon change in the manifest: converts again', async () => {
    await runPipeline({name: 'Icons', icons: {'48': 'icon48.png'}})

    const tools = fakeSafariTools()
    const {logs} = await runPipeline(
      {name: 'Icons', icons: {'48': 'icon48.png', '128': 'icon128.png'}},
      {tools}
    )

    expect(tools.calls.converter).toHaveLength(1)
    expect(logs).toContain(messages.safariProjectStale())
  })

  it('--force-regenerate: converts a fresh project and names the flag', async () => {
    await runPipeline(manifest)
    const tools = fakeSafariTools()
    const {logs} = await runPipeline(manifest, {
      tools,
      host: {forceRegenerate: true}
    })

    expect(tools.calls.converter).toHaveLength(1)
    expect(logs).toContain(messages.safariForcedRegeneration())
    expect(logs).not.toContain(messages.safariProjectStale())
  })

  it('user Xcode signing settings survive a regeneration', async () => {
    await runPipeline({name: 'SignedExt', icons: {'48': 'icon48.png'}})

    const projFile = pbxprojPath(configFor())
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

    const tools = fakeSafariTools()
    const {logs} = await runPipeline(
      {name: 'SignedExt', icons: {'48': 'icon48.png', '128': 'icon128.png'}},
      {tools}
    )

    expect(tools.calls.converter).toHaveLength(1)
    expect(logs).toContain(
      messages.safariSettingsPreserved(['DEVELOPMENT_TEAM', 'CODE_SIGN_STYLE'])
    )

    const regenerated = fs.readFileSync(projFile, 'utf8')
    expect(regenerated).toContain('DEVELOPMENT_TEAM = USERTEAM42;')
    expect(regenerated).toContain('CODE_SIGN_STYLE = Automatic;')
    expect(regenerated).toContain(
      'PRODUCT_BUNDLE_IDENTIFIER = "dev.extensionjs.SignedExt.Extension";'
    )
  })

  it('converter warnings: names the keys and marks world as kept on purpose', async () => {
    const tools = fakeSafariTools({
      converter: {
        output: [
          'Xcode project location: /tmp/proj',
          'Warning: The following keys in your manifest.json are not supported:',
          '\tworld',
          '\tpersistent',
          'Finished converting.'
        ].join('\n')
      }
    })
    const {logs} = await runPipeline(manifest, {tools})

    const warning = logs.find((line) =>
      /safari-web-extension-converter reported/.test(line)
    )
    expect(warning).toBe(
      messages.safariConverterWarnings([
        'Warning: The following keys in your manifest.json are not supported:',
        'world',
        'persistent'
      ])
    )

    expect(warning).toMatch(/3 warnings/)
    expect(warning).toMatch(/kept one of these keys on purpose/)
    expect(warning).toMatch(/Safari 18/)
    expect(tools.calls.xcodebuild).toHaveLength(1)
  })

  it('prints no converter warning when the converter was quiet', async () => {
    const {logs} = await runPipeline(manifest)

    expect(
      logs.some((line) => /safari-web-extension-converter reported/.test(line))
    ).toBe(false)
  })

  it('xcodebuild failure: prints a bounded tail, throws, and never opens', async () => {
    const noise = Array.from({length: 300}, (_, i) => `xcodebuild line ${i}`)
    const tools = fakeSafariTools({
      xcodebuild: {
        code: 65,
        output: [...noise, 'error: Signing requires a development team'].join(
          '\n'
        )
      }
    })
    const logs: string[] = []

    await expect(runPipeline(manifest, {tools, logs})).rejects.toThrow(
      /xcodebuild failed \(exit 65\)/
    )

    const failure = logs.find((line) => /Safari packaging tool/.test(line))
    expect(failure).toContain('xcodebuild')
    expect(failure).toContain('exit 65')
    expect(failure).toContain('error: Signing requires a development team')
    expect(failure).toContain('xcodebuild line 299')
    expect(failure).not.toContain('xcodebuild line 200')
    expect(tools.calls.openApp).toHaveLength(0)
    expect(tools.calls.resolvePid).toHaveLength(0)
    expect(readReady().browserPid).toBeUndefined()
  })

  it('converter failure: throws before xcodebuild runs and leaves no fingerprint', async () => {
    const tools = fakeSafariTools({
      converter: {code: 1, output: 'error: manifest.json not found'}
    })
    const logs: string[] = []

    await expect(runPipeline(manifest, {tools, logs})).rejects.toThrow(
      /safari-web-extension-converter failed \(exit 1\)/
    )

    const failure = logs.find((line) => /Safari packaging tool/.test(line))
    expect(failure).toContain('safari-web-extension-converter')
    expect(failure).toContain('error: manifest.json not found')
    expect(tools.calls.xcodebuild).toHaveLength(0)
    expect(fs.existsSync(manifestFingerprintPath(configFor()))).toBe(false)
  })

  it('--no-open: builds, points at the app, and touches neither open nor pluginkit', async () => {
    const {logs, tools} = await runPipeline(manifest, {host: {noOpen: true}})
    const appPath = builtAppPath(configFor())

    expect(tools.calls.xcodebuild).toHaveLength(1)
    expect(tools.calls.openApp).toHaveLength(0)
    expect(tools.calls.resolvePid).toHaveLength(0)
    expect(tools.calls.pluginkit).toBe(0)
    expect(logs).toContain(messages.safariBuilt(appPath))
    expect(logs).toContain(messages.safariOpenHint(appPath, 'MyExt'))
    expect(logs).not.toContain(messages.safariNextSteps('MyExt', false))
    expect(readReady()).toEqual({
      status: 'ready',
      browser: 'safari',
      command: 'dev'
    })
  })

  it('pid lookup comes back empty: ready.json still names the app and a line says so', async () => {
    const tools = fakeSafariTools({pid: null})
    const {logs} = await runPipeline(manifest, {tools})
    const appPath = builtAppPath(configFor())

    expect(tools.calls.openApp).toEqual([appPath])
    expect(tools.calls.resolvePid).toEqual(['dev.extensionjs.MyExt'])

    const ready = readReady()
    expect(ready.browserPid).toBeUndefined()
    expect(ready).toMatchObject({
      extensionId: 'dev.extensionjs.MyExt.Extension',
      binary: appPath,
      binaryProvenance: 'system'
    })

    expect(logs).toContain(messages.safariPidUnresolved('MyExt'))
    expect(logs).toContain(messages.safariNextSteps('MyExt', false))
    expect(logs).toContain(messages.safariRegistered('MyExt'))
  })

  it('pinned Safari binary: raises Safari itself and stamps that as the browser', async () => {
    const {tools} = await runPipeline(manifest, {
      host: {safariBinary: '/Applications/Safari.app'}
    })
    const appPath = builtAppPath(configFor())

    expect(tools.calls.openApp).toEqual([appPath])
    expect(tools.calls.openSafari).toEqual(['/Applications/Safari.app'])
    expect(tools.calls.resolvePid).toEqual(['com.apple.Safari'])
    expect(readReady()).toMatchObject({
      browserPid: 4242,
      binary: '/Applications/Safari.app',
      binaryProvenance: 'pinned',
      extensionId: 'dev.extensionjs.MyExt.Extension'
    })
  })

  it('non-macOS host: warns and runs no tool at all', async () => {
    const tools = fakeSafariTools({platformOk: false})
    const {logs, result} = await runPipeline(manifest, {tools})

    expect(logs).toContain(messages.safariRequiresMacOS(process.platform))
    expect(processEvents(tools)).toEqual([])
    expect(result.bundleId).toBe('dev.extensionjs.MyExt')
  })

  it('broken Xcode install: names the missing tool and runs nothing', async () => {
    const tools = fakeSafariTools({toolchainOk: false})
    const {logs} = await runPipeline(manifest, {tools})

    expect(logs).toContain(
      messages.safariToolchainMissing('safari-web-extension-converter')
    )

    expect(processEvents(tools)).toEqual([])
  })

  it('dry run: describes both commands and runs no tool', async () => {
    const tools = fakeSafariTools()
    const {result} = await runPipeline(manifest, {tools, host: {dryRun: true}})

    expect(processEvents(tools)).toEqual([])
    expect(result.appPath).toBe(builtAppPath(configFor()))
  })
})

// Apple prints a header line containing "Warning:" and then names the offending
// keys on INDENTED lines that never say "warning". Keeping only the header told
// the user something was unsupported and never which key.
describe('converterWarnings', () => {
  const output = [
    'Xcode project location: /tmp/proj',
    'Warning: The following keys in your manifest.json are not supported:',
    '\tpersistent',
    '\tside_panel',
    'Finished converting.'
  ].join('\n')

  it('keeps the indented keys that follow a warning header', () => {
    expect(converterWarnings(output)).toEqual([
      'Warning: The following keys in your manifest.json are not supported:',
      'persistent',
      'side_panel'
    ])
  })

  it('stops at the first line that is not indented', () => {
    expect(converterWarnings(output)).not.toContain('Finished converting.')
    expect(converterWarnings(output)).not.toContain(
      'Xcode project location: /tmp/proj'
    )
  })

  it('returns nothing when the converter printed no warning', () => {
    expect(
      converterWarnings('Finished converting.\n  indented but no header')
    ).toEqual([])
  })

  it('handles two warning blocks', () => {
    const two = [
      'Warning: first thing',
      '  keyA',
      'unrelated',
      'Warning: second thing',
      '  keyB'
    ].join('\n')
    expect(converterWarnings(two)).toEqual([
      'Warning: first thing',
      'keyA',
      'Warning: second thing',
      'keyB'
    ])
  })
})
