import {spawn} from 'node:child_process'
import {once} from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {
  cleanupOldTempProfiles,
  markManagedEphemeralProfile,
  parseEnvBrowserFlags
} from '../../browsers-lib/shared-utils'
import {
  browserConfig,
  DEFAULT_BROWSER_FLAGS,
  getChromiumMasterPreferences
} from '../../run-chromium/chromium-launch/browser-config'
import {
  chromeMasterPreferences,
  edgeMasterPreferences,
  getForkPreferences
} from '../../run-chromium/chromium-launch/master-preferences'

const makeTempFolder = trackTempFolders()
// A folder of this file's own: other sessions run the same suite at once.
const projectDir = makeTempFolder('extjs-flags-project-')

function makeCompilation(out = path.join(projectDir, 'dist', 'chrome')) {
  return {options: {output: {path: out}}} as any
}

// Chromium keeps one merged --disable-features switch, so an exclusion has to
// be judged on the entries inside it rather than on a substring of the whole.
function disabledFeatureEntries(flags: string[]) {
  const switchFlag = flags.find((f) => f.startsWith('--disable-features='))
  expect(switchFlag).toBeTruthy()

  return String(switchFlag).replace('--disable-features=', '').split(',')
}

function getUserDataDir(flags: string[]) {
  const userDirFlag = flags.find((f) => f.startsWith('--user-data-dir='))
  expect(userDirFlag).toBeTruthy()

  return String(userDirFlag).replace('--user-data-dir=', '')
}

describe('Chromium profile flags', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()

    try {
      const distRoot = path.join(projectDir, 'dist')
      fs.rmSync(distRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  it('adds --user-data-dir for ephemeral profile by default', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const userDir = flags.find((f: string) => f.startsWith('--user-data-dir='))
    expect(userDir).toBeTruthy()
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
    expect(getUserDataDir(flags)).toBe(
      path.join(
        projectDir,
        'dist',
        'extension-js',
        'profiles',
        'chrome-profile',
        'dev'
      )
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
    const sharedOut = path.join(projectDir, 'dist', 'chrome')
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
    const explicitProfile = makeTempFolder('extjs-explicit-profile-')
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
    const projectA = makeTempFolder('extjs-profile-ctx-a-')
    const projectB = makeTempFolder('extjs-profile-ctx-b-')
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
      } catch {
        // Ignore
      }
    }
  })

  it('keeps absolute explicit profile paths as-is regardless of context', () => {
    const explicitProfile = makeTempFolder('extjs-explicit-abs-')
    const projectDir = makeTempFolder('extjs-project-')

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
      } catch {
        // Ignore
      }
    }
  })

  it.skipIf(process.platform === 'win32')(
    'throws when a live browser holds the explicit profile',
    async () => {
      const explicitProfile = makeTempFolder('extjs-explicit-profile-live-')
      // Named chromium in the process table, the way a browser would be. `--`
      // keeps the flag an argument of the script, or node refuses it and exits.
      const holder = spawn(
        process.execPath,
        [
          '-e',
          'setTimeout(() => {}, 30000)',
          '--',
          `--user-data-dir=${explicitProfile}`
        ],
        {stdio: 'ignore', argv0: 'chromium'}
      )
      await once(holder, 'spawn')

      try {
        fs.symlinkSync(
          `${os.hostname()}-${holder.pid}`,
          path.join(explicitProfile, 'SingletonLock')
        )

        expect(() =>
          browserConfig(makeCompilation(), {
            extension: '/ext',
            browser: 'chrome',
            profile: explicitProfile
          } as any)
        ).toThrow(/already in use by process/i)
      } finally {
        holder.kill('SIGKILL')
      }
    }
  )

  it('cleans old managed ephemeral profiles regardless of naming', () => {
    const baseDir = makeTempFolder('extjs-managed-profiles-')
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
    const baseDir = makeTempFolder('extjs-managed-profiles-unmarked-')
    const customDir = path.join(baseDir, 'custom-profile')

    fs.mkdirSync(customDir, {recursive: true})
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(customDir, old, old)

    cleanupOldTempProfiles(baseDir, undefined, 1)

    expect(fs.existsSync(customDir)).toBe(true)
  })
})

describe('Chromium container sandbox flags', () => {
  const OLD_PLATFORM = process.platform

  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(process, 'platform', {value: OLD_PLATFORM})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(process, 'platform', {value: OLD_PLATFORM})

    try {
      const distRoot = path.join(projectDir, 'dist')
      fs.rmSync(distRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function flagsForEnv(envOverrides: Record<string, string | undefined> = {}) {
    Object.defineProperty(process, 'platform', {value: 'linux'})

    for (const [name, value] of Object.entries(envOverrides)) {
      vi.stubEnv(name, value)
    }

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
    vi.stubEnv('CI', 'true')
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(flags).not.toContain('--no-sandbox')
  })

  it('does NOT add --no-sandbox on Linux without container indicators', () => {
    Object.defineProperty(process, 'platform', {value: 'linux'})
    vi.stubEnv('CI', undefined)
    vi.stubEnv('REMOTE_CONTAINERS', undefined)
    vi.stubEnv('CODESPACES', undefined)
    vi.stubEnv('container', undefined)
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(flags).not.toContain('--no-sandbox')
  })
})

describe('Chromium feature-switch merging', () => {
  it('emits exactly one --disable-features switch with every default feature', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const disables = flags.filter((f: string) =>
      f.startsWith('--disable-features=')
    )
    expect(disables).toHaveLength(1)
    const features = disables[0].replace('--disable-features=', '').split(',')

    for (const feature of [
      'InterestFeedContentSuggestions',
      'Translate',
      'MediaRoute',
      'DisableLoadExtensionCommandLineSwitch',
      'ExtensionDisableUnsupportedDeveloper',
      'SafetyHubExtensionsOffStoreTrigger',
      'TranslateUI'
    ]) {
      expect(features).toContain(feature)
    }
  })

  it('emits exactly one --enable-features switch', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const enables = flags.filter((f: string) =>
      f.startsWith('--enable-features=')
    )
    expect(enables).toHaveLength(1)
    expect(enables[0]).toContain('SidePanelUpdates')
  })

  it('merges user-provided feature switches instead of dropping defaults', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      browserFlags: [
        '--disable-features=MyCustomFeature',
        '--enable-features=MyEnabledFeature'
      ]
    } as any)
    const disables = flags.filter((f: string) =>
      f.startsWith('--disable-features=')
    )
    expect(disables).toHaveLength(1)
    expect(disables[0]).toContain('MyCustomFeature')
    expect(disables[0]).toContain('DisableLoadExtensionCommandLineSwitch')
    const enables = flags.filter((f: string) =>
      f.startsWith('--enable-features=')
    )
    expect(enables).toHaveLength(1)
    expect(enables[0]).toContain('MyEnabledFeature')
    expect(enables[0]).toContain('SidePanelUpdates')
  })

  it('excludeBrowserFlags can still drop an individual feature entry', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      excludeBrowserFlags: [
        '--disable-features=ExtensionDisableUnsupportedDeveloper'
      ]
    } as any)
    const disables = flags.find((f: string) =>
      f.startsWith('--disable-features=')
    )
    expect(disables).not.toContain('ExtensionDisableUnsupportedDeveloper')
    expect(disables).toContain('DisableLoadExtensionCommandLineSwitch')
  })

  it('excludeBrowserFlags cancels user-layer browserFlags entries too', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      browserFlags: ['--start-maximized', '--kiosk'],
      excludeBrowserFlags: ['--start-maximized']
    } as any)
    expect(flags).not.toContain('--start-maximized')
    expect(flags).toContain('--kiosk')
  })

  it('excludeBrowserFlags cancels the tooling flags Extension.js adds', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      excludeBrowserFlags: ['--disable-dev-shm-usage', '--memory-pressure-off']
    } as any)
    expect(flags).not.toContain('--disable-dev-shm-usage')
    expect(flags).not.toContain('--memory-pressure-off')
    expect(flags).toContain('--disable-hang-monitor')
    expect(flags).toContain('--max_old_space_size=4096')
  })

  it('excluding TranslateUI drops it from the merged feature switch', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      excludeBrowserFlags: ['--disable-features=TranslateUI']
    } as any)
    const entries = disabledFeatureEntries(flags)
    expect(entries).not.toContain('TranslateUI')
    expect(entries).toContain('Translate')
    expect(entries).toContain('MediaRoute')
  })

  it('excluding Translate drops it without taking TranslateUI along', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      excludeBrowserFlags: ['--disable-features=Translate']
    } as any)
    const entries = disabledFeatureEntries(flags)
    expect(entries).not.toContain('Translate')
    expect(entries).toContain('TranslateUI')
    expect(entries).toContain('MediaRoute')
  })

  it('excluding both translation switches clears the pair', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      excludeBrowserFlags: [
        '--disable-features=Translate',
        '--disable-features=TranslateUI'
      ]
    } as any)
    const entries = disabledFeatureEntries(flags)
    expect(entries).not.toContain('Translate')
    expect(entries).not.toContain('TranslateUI')
    expect(entries).toContain('MediaRoute')
  })

  it('an exclude never loose-prefix cancels a longer flag name', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      browserFlags: ['--foobar', '--foo=value'],
      excludeBrowserFlags: ['--foo']
    } as any)
    expect(flags).toContain('--foobar')
    expect(flags).not.toContain('--foo=value')
  })
})

describe('EXTENSION_BROWSER_FLAGS environment pass-through', () => {
  beforeEach(() => {
    // The operator shell exports the focus-steal guard; these cases are about
    // the pass-through channel alone, so the guard has to be silent here.
    vi.stubEnv('EXTENSION_HEADLESS', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()

    try {
      fs.rmSync(path.join(projectDir, 'dist'), {
        recursive: true,
        force: true
      })
    } catch {
      // Ignore
    }
  })

  it('parses whitespace-separated flags and ignores empty input', () => {
    expect(parseEnvBrowserFlags(undefined)).toEqual([])
    expect(parseEnvBrowserFlags('')).toEqual([])
    expect(parseEnvBrowserFlags('   ')).toEqual([])
    expect(parseEnvBrowserFlags('--headless=new')).toEqual(['--headless=new'])
    expect(parseEnvBrowserFlags('  --headless=new \t --mute-audio ')).toEqual([
      '--headless=new',
      '--mute-audio'
    ])
  })

  it('appends env flags to the launched flag list', () => {
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', '--headless=new')
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(flags).toContain('--headless=new')
  })

  it('adds nothing when the env var is unset', () => {
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', undefined)
    const baseline = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(baseline.some((f: string) => f.includes('--headless'))).toBe(false)
  })

  it('env feature switches merge with defaults instead of clobbering them', () => {
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', '--disable-features=EnvOnlyFeature')
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const disables = flags.filter((f: string) =>
      f.startsWith('--disable-features=')
    )
    expect(disables).toHaveLength(1)
    expect(disables[0]).toContain('EnvOnlyFeature')
    expect(disables[0]).toContain('ExtensionDisableUnsupportedDeveloper')
  })

  it('env flags land after config browserFlags', () => {
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', '--headless=new')
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      browserFlags: ['--window-size=800,600']
    } as any)
    expect(flags.indexOf('--headless=new')).toBeGreaterThan(
      flags.indexOf('--window-size=800,600')
    )
  })
})

describe('EXTENSION_HEADLESS focus-steal guard', () => {
  beforeEach(() => {
    // The operator shell may export a headless flag; these cases are about
    // the guard alone, so the pass-through channel has to be silent.
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()

    try {
      fs.rmSync(path.join(projectDir, 'dist'), {
        recursive: true,
        force: true
      })
    } catch {}
  })

  it('forces --headless=new when EXTENSION_HEADLESS=1', () => {
    vi.stubEnv('EXTENSION_HEADLESS', '1')
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(flags).toContain('--headless=new')
  })

  it('defers to an explicit --headless flavor already in the flag list', () => {
    vi.stubEnv('EXTENSION_HEADLESS', 'true')
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      browserFlags: ['--headless=old']
    } as any)
    expect(flags).toContain('--headless=old')
    expect(flags).not.toContain('--headless=new')
  })

  it('stays headed when the guard is unset or disabled', () => {
    vi.stubEnv('EXTENSION_HEADLESS', undefined)
    const unset = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(unset.some((f: string) => f.startsWith('--headless'))).toBe(false)

    vi.stubEnv('EXTENSION_HEADLESS', '0')
    const disabled = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    expect(disabled.some((f: string) => f.startsWith('--headless'))).toBe(false)
  })
})

describe('chromium load-extension launch flags', () => {
  const flags = DEFAULT_BROWSER_FLAGS.map((flag) => String(flag))

  it('disables the switch policy that makes Chrome ignore --load-extension', () => {
    expect(flags).toContain(
      '--disable-features=DisableLoadExtensionCommandLineSwitch'
    )
  })

  it('keeps the flag that allows CDP extension debugging', () => {
    expect(flags).toContain('--enable-unsafe-extension-debugging')
  })

  it('keeps the flag that survives a developer-mode reload', () => {
    expect(flags).toContain(
      '--disable-features=ExtensionDisableUnsupportedDeveloper'
    )
  })

  it('keeps the safety check off the reloaded unpacked extension', () => {
    expect(flags).toContain(
      '--disable-features=SafetyHubExtensionsOffStoreTrigger'
    )
  })
})

type Prefs = Record<string, any>

describe('chromium fork first-run preferences', () => {
  it('marks the Vivaldi welcome page as seen so a fresh profile opens on the extension', () => {
    const prefs = getChromiumMasterPreferences('vivaldi') as Prefs

    expect(prefs.vivaldi.startup.has_seen_welcome_page).toBe(true)
    // The shared Chromium suppression stays underneath the fork's own keys.
    expect(prefs.distribution.suppress_first_run_bubble).toBe(true)
    expect(prefs.session.restore_on_startup).toBe(5)
  })

  it('adds nothing fork specific for chrome, edge, chromium or an unknown browser', () => {
    expect(getForkPreferences('chrome')).toEqual({})
    expect(getForkPreferences('chromium')).toEqual({})
    expect(getForkPreferences(undefined)).toEqual({})
    expect(getChromiumMasterPreferences('chrome')).toEqual(
      chromeMasterPreferences
    )

    expect(getChromiumMasterPreferences('edge')).toEqual(edgeMasterPreferences)
  })
})
