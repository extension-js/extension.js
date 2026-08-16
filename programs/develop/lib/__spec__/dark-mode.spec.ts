import {describe, expect, it} from 'vitest'
import {getDarkModeDefaults, withDarkMode} from '../dark-mode'

describe('getDarkModeDefaults', () => {
  it('returns Chromium flags for chrome-family browsers', () => {
    expect(getDarkModeDefaults('chrome')).toEqual({
      browserFlags: ['--force-dark-mode', '--enable-features=WebUIDarkMode'],
      preferences: {}
    })
    expect(getDarkModeDefaults('edge').browserFlags).toEqual(
      getDarkModeDefaults('chrome').browserFlags
    )
    expect(getDarkModeDefaults('chromium').browserFlags).toEqual(
      getDarkModeDefaults('chrome').browserFlags
    )
  })

  it('returns Gecko color-scheme prefs for firefox-family browsers', () => {
    expect(getDarkModeDefaults('firefox')).toEqual({
      browserFlags: [],
      preferences: {
        'ui.systemUsesDarkTheme': 1,
        'layout.css.prefers-color-scheme.content-override': 2,
        'devtools.theme': 'dark'
      }
    })
  })

  it('returns empty defaults for Safari', () => {
    expect(getDarkModeDefaults('safari')).toEqual({
      browserFlags: [],
      preferences: {}
    })
  })
})

describe('withDarkMode', () => {
  it('appends Chromium appearance defaults after user flags', () => {
    const result = withDarkMode({
      browser: 'chrome',
      browserFlags: ['--from-user']
    })
    expect(result.browserFlags).toEqual([
      '--from-user',
      '--force-dark-mode',
      '--enable-features=WebUIDarkMode'
    ])
  })

  it('does not duplicate flags the user already set', () => {
    const result = withDarkMode({
      browser: 'chrome',
      browserFlags: ['--force-dark-mode', '--enable-features=WebUIDarkMode']
    })
    expect(result.browserFlags).toEqual([
      '--force-dark-mode',
      '--enable-features=WebUIDarkMode'
    ])
  })

  it('lets excludeBrowserFlags drop --force-dark-mode and the rest of the bundle', () => {
    const chromium = withDarkMode({
      browser: 'chrome',
      browserFlags: ['--from-user'],
      excludeBrowserFlags: ['--force-dark-mode']
    })
    expect(chromium.browserFlags).toEqual(['--from-user'])

    const gecko = withDarkMode({
      browser: 'firefox',
      excludeBrowserFlags: ['--force-dark-mode']
    })
    expect(gecko.preferences).toEqual({})
  })

  it('lets excludeBrowserFlags drop just WebUIDarkMode', () => {
    const result = withDarkMode({
      browser: 'chrome',
      excludeBrowserFlags: ['--enable-features=WebUIDarkMode']
    })
    expect(result.browserFlags).toEqual(['--force-dark-mode'])
  })

  it('never overwrites a preference the user already set', () => {
    const result = withDarkMode({
      browser: 'firefox',
      preferences: {
        'ui.systemUsesDarkTheme': 0,
        'devtools.theme': 'light'
      }
    })
    expect(result.preferences).toEqual({
      'ui.systemUsesDarkTheme': 0,
      'devtools.theme': 'light',
      'layout.css.prefers-color-scheme.content-override': 2
    })
  })

  it('folds WebUIDarkMode into a user --enable-features switch', () => {
    const result = withDarkMode({
      browser: 'chrome',
      browserFlags: ['--enable-features=Foo']
    })
    expect(result.browserFlags).toEqual([
      '--enable-features=Foo,WebUIDarkMode',
      '--force-dark-mode'
    ])
  })

  it('does not re-enable a feature the user disabled', () => {
    const result = withDarkMode({
      browser: 'chrome',
      browserFlags: ['--disable-features=WebUIDarkMode']
    })
    expect(result.browserFlags).toEqual([
      '--disable-features=WebUIDarkMode',
      '--force-dark-mode'
    ])
  })
})
