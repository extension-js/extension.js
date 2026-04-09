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
