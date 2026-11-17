import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  normalizeProfileOption,
  resolveProfileConfig
} from '../browsers-lib/resolve-profile'

let tmpRoot = ''

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-spec-'))
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  } catch {
    // Ignore
  }
})

function resolve(rawProfile: string | boolean | undefined) {
  return resolveProfileConfig({
    rawProfile,
    managedBaseDir: path.join(tmpRoot, 'profiles', 'chrome-profile'),
    useSystemProfile: false,
    resolveExplicit: (trimmed) => path.resolve(tmpRoot, trimmed)
  })
}

describe('normalizeProfileOption', () => {
  it('maps false and the string false to the system profile sentinel', () => {
    expect(normalizeProfileOption(false)).toBe(false)
    expect(normalizeProfileOption('false')).toBe(false)
    expect(normalizeProfileOption('FALSE')).toBe(false)
    expect(normalizeProfileOption(' false ')).toBe(false)
  })

  it('maps true and the string true to the managed default', () => {
    expect(normalizeProfileOption(true)).toBeUndefined()
    expect(normalizeProfileOption('true')).toBeUndefined()
  })

  it('keeps real paths and unset values as they are', () => {
    expect(normalizeProfileOption('/some/profile')).toBe('/some/profile')
    expect(normalizeProfileOption('falsey-dir')).toBe('falsey-dir')
    expect(normalizeProfileOption(undefined)).toBeUndefined()
  })
})

describe('resolveProfileConfig profile=false coercion', () => {
  it('treats the string false exactly like the boolean', () => {
    const fromString = resolve('false')
    const fromBoolean = resolve(false)

    expect(fromString.kind).toBe('system')
    expect(fromString.profilePath).toBe('')
    expect(fromBoolean.kind).toBe('system')
    // No literal directory named false is materialized anywhere.
    expect(fs.existsSync(path.resolve(tmpRoot, 'false'))).toBe(false)
  })

  it('still honors an explicit path that merely contains false', () => {
    const resolved = resolve('false-positives')
    expect(resolved.kind).toBe('explicit')
    expect(resolved.profilePath).toBe(path.resolve(tmpRoot, 'false-positives'))
  })

  it('falls back to a managed profile when unset', () => {
    const resolved = resolve(undefined)
    expect(resolved.kind).toBe('managed')
    expect(resolved.profilePath).toContain(
      path.join('profiles', 'chrome-profile')
    )
  })
})

describe('a kept profile an earlier version left at another path', () => {
  function resolveKept(provision = true) {
    return resolveProfileConfig({
      rawProfile: undefined,
      managedBaseDir: path.join(
        tmpRoot,
        'app',
        'dist',
        'extension-js',
        'profiles',
        'chrome-profile'
      ),
      earlierManagedBaseDir: path.join(
        tmpRoot,
        'extension-js',
        'profiles',
        'chrome-profile'
      ),
      useSystemProfile: false,
      persistProfile: true,
      provision,
      browser: 'chrome',
      resolveExplicit: (trimmed) => path.resolve(tmpRoot, trimmed)
    })
  }

  const current = () =>
    path.join(
      tmpRoot,
      'app',
      'dist',
      'extension-js',
      'profiles',
      'chrome-profile',
      'dev'
    )

  const earlier = () =>
    path.join(tmpRoot, 'extension-js', 'profiles', 'chrome-profile', 'dev')

  it('uses the documented place when nothing was left behind', () => {
    const resolved = resolveKept()

    expect(resolved.profilePath).toBe(current())
    expect(fs.existsSync(earlier())).toBe(false)
  })

  it('keeps using the earlier profile and says where the new one lives', () => {
    fs.mkdirSync(earlier(), {recursive: true})
    fs.writeFileSync(path.join(earlier(), 'Cookies'), 'kept')

    const said = vi.spyOn(console, 'log').mockImplementation(() => {})
    const resolved = resolveKept()
    const again = resolveKept()
    const lines = said.mock.calls.map((call) => String(call[0]))

    said.mockRestore()

    expect(resolved.profilePath).toBe(earlier())
    expect(again.profilePath).toBe(earlier())
    expect(resolved.persisted).toBe(true)
    expect(fs.readFileSync(path.join(earlier(), 'Cookies'), 'utf-8')).toBe(
      'kept'
    )

    expect(fs.existsSync(current())).toBe(false)

    const notes = lines.filter((line) => line.includes('earlier version'))

    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain(earlier())
    expect(notes[0]).toContain(current())
  })

  it('prefers a profile that already exists at the documented place', () => {
    fs.mkdirSync(earlier(), {recursive: true})
    fs.writeFileSync(path.join(earlier(), 'Cookies'), 'old')
    fs.mkdirSync(current(), {recursive: true})
    fs.writeFileSync(path.join(current(), 'Cookies'), 'new')

    expect(resolveKept().profilePath).toBe(current())
  })

  it('never reads the earlier path for a fresh profile', () => {
    fs.mkdirSync(earlier(), {recursive: true})
    fs.writeFileSync(path.join(earlier(), 'Cookies'), 'kept')

    const resolved = resolveProfileConfig({
      rawProfile: undefined,
      managedBaseDir: path.dirname(current()),
      earlierManagedBaseDir: path.dirname(earlier()),
      useSystemProfile: false,
      resolveExplicit: (trimmed) => path.resolve(tmpRoot, trimmed)
    })

    expect(resolved.persisted).toBe(false)
    expect(path.dirname(resolved.profilePath)).toBe(path.dirname(current()))
  })
})
