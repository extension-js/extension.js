import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {resolveProfileConfig} from '../browsers-lib/resolve-profile'
import {browserConfig} from '../run-chromium/chromium-launch/browser-config'

const SINGLETON_ARTIFACTS = [
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie'
]

function userDataDir(flags: string[]): string {
  const flag = flags.find((f) => f.startsWith('--user-data-dir='))
  if (!flag) throw new Error('--user-data-dir flag not found')

  return flag.replace('--user-data-dir=', '')
}

function readPreferences(dir: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8')
  )
}

describe('copyFromProfile seeding', () => {
  let scratch: string
  let source: string

  beforeEach(() => {
    vi.restoreAllMocks()
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-copy-from-'))
    source = path.join(scratch, 'live-chrome-profile')
    fs.mkdirSync(path.join(source, 'Default'), {recursive: true})
    fs.writeFileSync(
      path.join(source, 'Default', 'Preferences'),
      JSON.stringify({
        profile: {name: 'Person 1'},
        extensions: {ui: {developer_mode: false}}
      })
    )

    fs.writeFileSync(path.join(source, 'Default', 'Cookies'), 'cookie-db')
  })

  afterEach(() => {
    fs.rmSync(scratch, {recursive: true, force: true})
  })

  function makeCompilation() {
    return {
      options: {output: {path: path.join(scratch, 'project', 'dist', 'chrome')}}
    } as any
  }

  function expectSeededShape(dir: string) {
    const entries = fs.readdirSync(dir)

    for (const name of SINGLETON_ARTIFACTS) {
      expect(entries).not.toContain(name)
    }

    expect(fs.readFileSync(path.join(dir, 'Default', 'Cookies'), 'utf8')).toBe(
      'cookie-db'
    )

    const prefs = readPreferences(dir)
    expect(prefs.profile.name).toBe('Person 1')
    expect(prefs.extensions.ui.developer_mode).toBe(true)
    expect(prefs.extensions.developer_mode).toBe(true)
    expect(prefs.distribution.suppress_first_run_bubble).toBe(true)
  }

  it.skipIf(process.platform === 'win32')(
    'leaves a live browser lock and socket behind and merges the master preferences',
    () => {
      fs.symlinkSync(
        `${os.hostname()}-${process.pid}`,
        path.join(source, 'SingletonLock')
      )

      fs.symlinkSync(
        path.join(
          os.tmpdir(),
          '.org.chromium.Chromium.none',
          'SingletonSocket'
        ),
        path.join(source, 'SingletonSocket')
      )

      fs.writeFileSync(path.join(source, 'SingletonCookie'), '1')

      const flags = browserConfig(makeCompilation(), {
        extension: '/ext',
        browser: 'chrome',
        copyFromProfile: source
      } as any)

      expectSeededShape(userDataDir(flags))
    }
  )

  it('drops regular-file lock artifacts and keeps the copied keys under ours', () => {
    for (const name of SINGLETON_ARTIFACTS) {
      fs.writeFileSync(
        path.join(source, name),
        `${os.hostname()}-${process.pid}`
      )
    }

    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      copyFromProfile: source,
      preferences: {profile: {name: 'Dev'}}
    } as any)

    const dir = userDataDir(flags)
    const entries = fs.readdirSync(dir)

    for (const name of SINGLETON_ARTIFACTS) {
      expect(entries).not.toContain(name)
    }

    const prefs = readPreferences(dir)
    expect(prefs.profile.name).toBe('Dev')
    expect(prefs.extensions.ui.developer_mode).toBe(true)
  })

  it('says so when the source does not exist and records no seed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = path.join(scratch, 'no-such-profile')

    const resolved = resolveProfileConfig({
      managedBaseDir: path.join(scratch, 'managed'),
      useSystemProfile: false,
      copyFromProfile: missing,
      resolveExplicit: (p) => p
    })

    expect(resolved.kind).toBe('managed')
    expect(resolved.seededFrom).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(missing)
    expect(fs.readdirSync(resolved.profilePath)).toEqual([
      '.extension-js-managed-profile'
    ])
  })

  it('does not claim a seed from a missing source in a dry run', () => {
    const resolved = resolveProfileConfig({
      managedBaseDir: path.join(scratch, 'managed'),
      useSystemProfile: false,
      copyFromProfile: path.join(scratch, 'no-such-profile'),
      resolveExplicit: (p) => p,
      provision: false
    })

    expect(resolved.seededFrom).toBeUndefined()
    expect(fs.existsSync(resolved.profilePath)).toBe(false)
  })
})
