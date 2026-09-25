import {describe, expect, it} from 'vitest'
import {getChromiumMasterPreferences} from '../run-chromium/chromium-launch/browser-config'
import {
  chromeMasterPreferences,
  edgeMasterPreferences,
  getForkPreferences
} from '../run-chromium/chromium-launch/master-preferences'

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
