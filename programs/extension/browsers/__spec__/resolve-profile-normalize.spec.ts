import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
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
