import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'

import {createProfile as createChromiumProfile} from '../run-chromium/create-profile'

function tmp(dir: string) {
  return path.resolve('/tmp', 'extjs-test', dir)
}

describe('Managed profile Preferences seeding', () => {
  const baseDist = tmp('dist')
  const chromeOut = path.join(baseDist, 'chrome')

  beforeEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(tmp(''), {recursive: true, force: true})
    } catch {}
    fs.mkdirSync(chromeOut, {recursive: true})
  })

  afterEach(() => {
    try {
      fs.rmSync(tmp(''), {recursive: true, force: true})
    } catch {}
  })

  it('writes Preferences on first creation (no dir exists)', () => {
    const compilation = {options: {output: {path: chromeOut}}} as any
    const profilePath = createChromiumProfile(compilation, {
      browser: 'chrome',
      userProfilePath: undefined,
      configPreferences: {custom_flag: true},
      instanceId: 'abc12345'
    })
    const pref = path.join(profilePath, 'Default', 'Preferences')
    expect(fs.existsSync(pref)).toBe(true)
    const data = JSON.parse(fs.readFileSync(pref, 'utf8'))
    expect(
      data.extensions?.ui?.developer_mode === true ||
        data.extensions?.developer_mode === true
    ).toBe(true)
    expect(data.custom_flag).toBe(true)
  })

  it('seeds Preferences if dir exists but file missing, and not locked', () => {
    const compilation = {options: {output: {path: chromeOut}}} as any
    const profilePath = createChromiumProfile(compilation, {
      browser: 'chrome',
      userProfilePath: undefined,
      configPreferences: {},
      instanceId: 'abc12345'
    })
    // Remove Preferences only
    const pref = path.join(profilePath, 'Default', 'Preferences')
    fs.rmSync(pref, {force: true})
    // Re-run creation, should seed Preferences back
    const again = createChromiumProfile(compilation, {
      browser: 'chrome',
      userProfilePath: undefined,
      configPreferences: {},
      instanceId: 'abc12345'
    })
    expect(again).toBe(profilePath)
    expect(fs.existsSync(pref)).toBe(true)
  })

  it('does not overwrite existing Preferences', () => {
    const compilation = {options: {output: {path: chromeOut}}} as any
    const profilePath = createChromiumProfile(compilation, {
      browser: 'chrome',
      userProfilePath: undefined,
      configPreferences: {},
      instanceId: 'abc12345'
    })
    const pref = path.join(profilePath, 'Default', 'Preferences')
    const original = {foo: 1}
    fs.writeFileSync(pref, JSON.stringify(original), 'utf8')
    const again = createChromiumProfile(compilation, {
      browser: 'chrome',
      userProfilePath: undefined,
      configPreferences: {bar: 2},
      instanceId: 'abc12345'
    })
    expect(again).toBe(profilePath)
    const data = JSON.parse(fs.readFileSync(pref, 'utf8'))
    expect(data).toEqual(original)
  })
})
