import {describe, expect, it} from 'vitest'
import masterPreferences, {
  getForkPreferences,
  getPreferences
} from '../run-firefox/firefox-launch/master-preferences'

describe('gecko fork first-run preferences', () => {
  it('marks Zen welcome screen as seen so a fresh profile opens on the extension', () => {
    const prefs = getPreferences({}, 'zen')

    expect(prefs['zen.welcome-screen.seen']).toBe(true)
    expect(prefs['zen.updates.show-update-notification']).toBe(false)
    expect(prefs['browser.aboutwelcome.enabled']).toBe(false)
  })

  it('keeps Floorp welcome page and release notes tabs closed', () => {
    const prefs = getPreferences({}, 'floorp')

    expect(prefs['floorp.browser.welcome.page.shown']).toBe(true)
    expect(prefs['floorp.releaseNotes.mode']).toBe('disabled')
    expect(prefs['floorp.releaseNotes.choiceConfirmed']).toBe(true)
    expect(prefs['floorp.releaseNotes.promptShown']).toBe(true)
  })

  it('adds nothing fork specific for firefox or an unknown browser', () => {
    expect(getForkPreferences('firefox')).toEqual({})
    expect(getForkPreferences(undefined)).toEqual({})
    expect(getPreferences({}, 'firefox')).toEqual(masterPreferences)
    expect(getPreferences({})).toEqual(masterPreferences)
  })

  it('lets a project preference override a fork default', () => {
    const prefs = getPreferences({'zen.welcome-screen.seen': false}, 'zen')

    expect(prefs['zen.welcome-screen.seen']).toBe(false)
  })
})
