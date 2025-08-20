import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

import {BrowsersPlugin} from '../index'
import {createProfile as createChromiumProfile} from '../run-chromium/create-profile'
import {createProfile as createFirefoxProfile} from '../run-firefox/firefox/create-profile'

describe('Profile option normalization and safety', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Ensure we work with the real fs in this suite; other tests mock it
    vi.unmock('fs')
  })

  it('normalizes plugin option profile: "false" => false and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'chrome',
      // Simulate CLI/config providing a string "false"
      profile: 'false'
    } as any)
    expect(plugin.profile).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('Chromium createProfile treats "false" as disabled and does not mkdir a "false" dir', () => {
    const fs = require('fs') as typeof import('fs')
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync')
    const existsSpy = vi.spyOn(fs, 'existsSync')

    const compilation = {
      options: {output: {path: path.resolve('/tmp/fake/dist/chrome')}}
    } as any

    const result = createChromiumProfile(compilation, {
      browser: 'chrome',
      userProfilePath: 'false',
      configPreferences: {},
      instanceId: 'abc12345'
    })

    expect(result).toBe('')

    // Ensure no attempt to create a directory literally named 'false'
    const createdFalseDir = mkdirSpy.mock.calls.some((args) => {
      const dir = String(args[0])
      return dir === 'false' || dir.endsWith(`${path.sep}false`)
    })
    expect(createdFalseDir).toBe(false)

    // Also ensure we did not probe a literal 'false' path
    const probedFalse = existsSpy.mock.calls.some((args) => {
      const p = String(args[0])
      return p === 'false' || p.endsWith(`${path.sep}false`)
    })
    expect(probedFalse).toBe(false)
  })

  it('Firefox createProfile treats "false" as disabled and does not mkdir a "false" dir', () => {
    const fs = require('fs') as typeof import('fs')
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync')
    const existsSpy = vi.spyOn(fs, 'existsSync')

    const compilation = {
      options: {output: {path: path.resolve('/tmp/fake/dist/firefox')}}
    } as any

    const profile = createFirefoxProfile(compilation, {
      browser: 'firefox',
      userProfilePath: 'false',
      configPreferences: {},
      instanceId: 'def67890'
    })

    // When disabled, FirefoxProfile points to empty path
    const profilePath = (profile as any).path?.() || ''
    expect(profilePath).toBe('')

    const createdFalseDir = mkdirSpy.mock.calls.some((args) => {
      const dir = String(args[0])
      return dir === 'false' || dir.endsWith(`${path.sep}false`)
    })
    expect(createdFalseDir).toBe(false)

    const probedFalse = existsSpy.mock.calls.some((args) => {
      const p = String(args[0])
      return p === 'false' || p.endsWith(`${path.sep}false`)
    })
    expect(probedFalse).toBe(false)
  })
})
