import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {browserConfig} from '../run-chromium/chromium-launch/browser-config'
import {
  cleanupOldTempProfiles,
  markManagedEphemeralProfile
} from '../browsers-lib/shared-utils'

function makeCompilation(
  out = path.join(os.tmpdir(), 'project', 'dist', 'chrome')
) {
  // Align with browserConfig expectations: Compilation.options.output.path
  return {options: {output: {path: out}}} as any
}

function getUserDataDir(flags: string[]) {
  const userDirFlag = flags.find((f) => f.startsWith('--user-data-dir='))
  expect(userDirFlag).toBeTruthy()
  return String(userDirFlag).replace('--user-data-dir=', '')
}

describe('Chromium profile flags', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = {...OLD_ENV}
  })
  afterEach(() => {
    process.env = OLD_ENV
    // Cleanup any temp output created under /tmp/project/dist
    try {
      const distRoot = path.join(os.tmpdir(), 'project', 'dist')
      fs.rmSync(distRoot, {recursive: true, force: true})
    } catch {}
  })

  it('adds --user-data-dir for ephemeral profile by default', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const userDir = flags.find((f: string) => f.startsWith('--user-data-dir='))
    expect(userDir).toBeTruthy()
    // Accept any ephemeral profile name under chrome-profile/
    expect(userDir).toMatch(
      /extension-js[\\/]+profiles[\\/]+chrome-profile[\\/]+/
    )
  })

  it('uses persistent dev profile when persistProfile=true', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      persistProfile: true
    } as any)
    const userDir = flags.find((f: string) => f.startsWith('--user-data-dir='))
    expect(userDir).toBeTruthy()
    // Allow optional trailing quote
    expect(userDir).toMatch(
      /extension-js[\\/]+profiles[\\/]+chrome-profile[\\/]dev"?$/
    )
  })

  it('seeds managed profile with developer mode preferences', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chromium'
    } as any)

    const profilePath = getUserDataDir(flags)
    const preferencesPath = path.join(profilePath, 'Default', 'Preferences')
    const preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'))

    expect(preferences?.extensions?.developer_mode).toBe(true)
    expect(preferences?.extensions?.ui?.developer_mode).toBe(true)
  })

  it('does not overwrite existing Preferences in persistent profiles', () => {
    const sharedOut = path.join(os.tmpdir(), 'project', 'dist', 'chrome')
    const initialFlags = browserConfig(makeCompilation(sharedOut), {
      extension: '/ext',
      browser: 'chrome',
      persistProfile: true
    } as any)

    const profilePath = getUserDataDir(initialFlags)
    const preferencesPath = path.join(profilePath, 'Default', 'Preferences')
    fs.writeFileSync(
      preferencesPath,
      JSON.stringify({extensions: {developer_mode: false}}),
      'utf8'
    )

    browserConfig(makeCompilation(sharedOut), {
      extension: '/ext',
      browser: 'chrome',
      persistProfile: true
    } as any)

    const preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'))
    expect(preferences?.extensions?.developer_mode).toBe(false)
  })

  it('removes stale Chromium singleton artifacts for explicit profiles', () => {
    const explicitProfile = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-explicit-profile-')
    )
    const host = os.hostname()
    fs.writeFileSync(
      path.join(explicitProfile, 'SingletonLock'),
      `${host}-999999999`,
      'utf8'
    )
    fs.writeFileSync(
      path.join(explicitProfile, 'SingletonCookie'),
      'cookie',
      'utf8'
    )
    fs.writeFileSync(
      path.join(explicitProfile, 'SingletonSocket'),
      'socket',
      'utf8'
    )

    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      profile: explicitProfile
    } as any)

    expect(flags).toContain(`--user-data-dir=${explicitProfile}`)
    expect(fs.existsSync(path.join(explicitProfile, 'SingletonLock'))).toBe(
      false
    )
    expect(fs.existsSync(path.join(explicitProfile, 'SingletonCookie'))).toBe(
      false
    )
    expect(fs.existsSync(path.join(explicitProfile, 'SingletonSocket'))).toBe(
      false
    )
  })

  it('resolves relative explicit profile paths against the compilation context, not process.cwd()', () => {
    // Regression: running examples sequentially from a parent directory used
    // to collapse every example's `profile: './dist/extension-profile-<browser>'`
    // to the same shared dir, because path.resolve() resolved against
    // process.cwd() instead of the project root that owns extension.config.js.
    // Chrome's persistent profile then carried the previous run's
    // --load-extension path into the next session and the previous example
    // appeared loaded in the new one.
    const projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-ctx-a-'))
    const projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-ctx-b-'))
    const oldCwd = process.cwd()

    try {
      process.chdir(os.tmpdir())

      const compilationA = {
        options: {
          context: projectA,
          output: {path: path.join(projectA, 'dist', 'chrome')}
        }
      } as any
      const compilationB = {
        options: {
          context: projectB,
          output: {path: path.join(projectB, 'dist', 'chrome')}
        }
      } as any

      const flagsA = browserConfig(compilationA, {
        extension: '/ext',
        browser: 'chrome',
        profile: './dist/extension-profile-chrome'
      } as any)
      const flagsB = browserConfig(compilationB, {
        extension: '/ext',
        browser: 'chrome',
        profile: './dist/extension-profile-chrome'
      } as any)

      const userDirA = getUserDataDir(flagsA)
      const userDirB = getUserDataDir(flagsB)

      expect(userDirA).toBe(
        path.resolve(projectA, 'dist', 'extension-profile-chrome')
      )
      expect(userDirB).toBe(
        path.resolve(projectB, 'dist', 'extension-profile-chrome')
      )
      expect(userDirA).not.toBe(userDirB)
    } finally {
      process.chdir(oldCwd)
      try {
        fs.rmSync(projectA, {recursive: true, force: true})
        fs.rmSync(projectB, {recursive: true, force: true})
      } catch {}
    }
  })

  it('keeps absolute explicit profile paths as-is regardless of context', () => {
    const explicitProfile = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-explicit-abs-')
    )
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-project-')
    )

    try {
      const compilation = {
        options: {
          context: projectDir,
          output: {path: path.join(projectDir, 'dist', 'chrome')}
        }
      } as any

      const flags = browserConfig(compilation, {
        extension: '/ext',
        browser: 'chrome',
        profile: explicitProfile
      } as any)

      expect(getUserDataDir(flags)).toBe(explicitProfile)
    } finally {
      try {
        fs.rmSync(explicitProfile, {recursive: true, force: true})
        fs.rmSync(projectDir, {recursive: true, force: true})
      } catch {}
    }
  })

  it('throws when explicit profile appears to be in use locally', () => {
    const explicitProfile = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-explicit-profile-live-')
    )
    fs.writeFileSync(
      path.join(explicitProfile, 'SingletonLock'),
      `${os.hostname()}-${process.pid}`,
      'utf8'
    )

    expect(() =>
      browserConfig(makeCompilation(), {
        extension: '/ext',
        browser: 'chrome',
        profile: explicitProfile
      } as any)
    ).toThrow(/already in use by process/i)
  })

  it('cleans old managed ephemeral profiles regardless of naming', () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-managed-profiles-')
    )
    const staleDir = path.join(baseDir, 'amber-fox-badger')
    const keepDir = path.join(baseDir, 'violet-otter-finch')
    const devDir = path.join(baseDir, 'dev')

    fs.mkdirSync(staleDir, {recursive: true})
    fs.mkdirSync(keepDir, {recursive: true})
    fs.mkdirSync(devDir, {recursive: true})
    markManagedEphemeralProfile(staleDir)
    markManagedEphemeralProfile(keepDir)

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(staleDir, old, old)
    fs.utimesSync(keepDir, old, old)
    fs.utimesSync(devDir, old, old)

    cleanupOldTempProfiles(baseDir, path.basename(keepDir), 1)

    expect(fs.existsSync(staleDir)).toBe(false)
    expect(fs.existsSync(keepDir)).toBe(true)
    expect(fs.existsSync(devDir)).toBe(true)
  })

  it('does not remove unmarked directories under the managed profile base', () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-managed-profiles-unmarked-')
    )
    const customDir = path.join(baseDir, 'custom-profile')

    fs.mkdirSync(customDir, {recursive: true})
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(customDir, old, old)

    cleanupOldTempProfiles(baseDir, undefined, 1)

    expect(fs.existsSync(customDir)).toBe(true)
  })
})

describe('Chromium container sandbox flags', () => {
  const OLD_ENV = process.env
  const OLD_PLATFORM = process.platform

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = {...OLD_ENV}
    // Default to non-Linux so tests are explicit about platform
    Object.defineProperty(process, 'platform', {value: OLD_PLATFORM})
  })
  afterEach(() => {
    process.env = OLD_ENV
    Object.defineProperty(process, 'platform', {value: OLD_PLATFORM})
    try {
      const distRoot = path.join(os.tmpdir(), 'project', 'dist')
      fs.rmSync(distRoot, {recursive: true, force: true})
    } catch {}
  })

  function flagsForEnv(envOverrides: Record<string, string | undefined> = {}) {
    Object.defineProperty(process, 'platform', {value: 'linux'})
    Object.assign(process.env, envOverrides)
    return browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
  }

  it('adds --no-sandbox when CI=true on Linux', () => {
    const flags = flagsForEnv({CI: 'true'})
    expect(flags).toContain('--no-sandbox')
    expect(flags).toContain('--disable-setuid-sandbox')
  })

  it('adds --no-sandbox when REMOTE_CONTAINERS=true on Linux', () => {
    const flags = flagsForEnv({REMOTE_CONTAINERS: 'true'})
    expect(flags).toContain('--no-sandbox')
  })

  it('adds --no-sandbox when CODESPACES=true on Linux', () => {
    const flags = flagsForEnv({CODESPACES: 'true'})
    expect(flags).toContain('--no-sandbox')
  })

  it('adds --no-sandbox when container env var is set on Linux', () => {
    const flags = flagsForEnv({container: 'podman'})
    expect(flags).toContain('--no-sandbox')
  })

  it('does NOT add --no-sandbox on non-Linux even with CI=true', () => {
    Object.defineProperty(process, 'platform', {value: 'darwin'})
    process.env.CI = 'true'
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(flags).not.toContain('--no-sandbox')
  })

  it('does NOT add --no-sandbox on Linux without container indicators', () => {
    Object.defineProperty(process, 'platform', {value: 'linux'})
    delete process.env.CI
    delete process.env.REMOTE_CONTAINERS
    delete process.env.CODESPACES
    delete process.env.container
    // Note: /.dockerenv and /run/.containerenv don't exist on standard test
    // hosts, so the fs.existsSync checks naturally return false here.
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(flags).not.toContain('--no-sandbox')
  })
})
