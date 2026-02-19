import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {browserConfig} from '../run-chromium/chromium-launch/browser-config'

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
})
