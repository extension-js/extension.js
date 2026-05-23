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
  builtAppPath
} from '../run-safari/safari-launch/safari-config'
import {
  detectSafariToolchain,
  isMacOS
} from '../run-safari/safari-launch/toolchain'
import {launchBrowser} from '../index'
import {safariPreflightError} from '../run-safari/safari-launch'
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
  it('flags non-macOS platforms and reassures the dist is intact', () => {
    const msg = messages.safariRequiresMacOS('linux')
    expect(msg).toMatch(/only be built on macOS/)
    expect(msg).toMatch(/Linux/)
    expect(msg).toMatch(/dist\/safari/)
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
