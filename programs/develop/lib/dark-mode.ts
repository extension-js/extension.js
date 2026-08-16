// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {BrowserConfig, BrowserType} from '../types'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from './constants'

// Cross-browser defaults to force dark mode: Chromium uses command-line flags,
// Firefox/Gecko writes user.js prefs for UI and prefers-color-scheme.
export function getDarkModeDefaults(
  browser: BrowserType
): Pick<BrowserConfig, 'browserFlags' | 'preferences'> {
  // Chromium family (chrome/edge + forks like brave/opera/vivaldi/yandex)
  // → prefer flags for reliable behavior.
  if (isChromiumBasedBrowser(String(browser))) {
    return {
      browserFlags: [
        '--force-dark-mode',
        // Enables dark styling for WebUI surfaces
        '--enable-features=WebUIDarkMode'
      ],
      preferences: {}
    }
  }

  // Firefox/Gecko family: set UI + content color-scheme prefs
  // (ui.systemUsesDarkTheme 1=dark; content-override 2=dark, 1=light, 0/3=system).
  if (isGeckoBasedBrowser(String(browser))) {
    return {
      browserFlags: [],
      preferences: {
        'ui.systemUsesDarkTheme': 1,
        'layout.css.prefers-color-scheme.content-override': 2,
        'devtools.theme': 'dark'
      }
    }
  }

  return {
    browserFlags: [],
    preferences: {}
  }
}

function normalizeFlag(flag: unknown): string {
  return String(flag ?? '').trim()
}

// Exact match, or an exclude prefix such as `--enable-features` covering
// `--enable-features=WebUIDarkMode`. The exclude knob is how callers opt out.
function isFlagExcluded(flag: string, excludeFlags: string[]): boolean {
  return excludeFlags.some((exclude) => {
    if (!exclude) return false
    if (flag === exclude) return true
    return flag.startsWith(`${exclude}=`) || flag.startsWith(`${exclude},`)
  })
}

function featureList(flag: string, switchName: string): string[] {
  const prefix = `${switchName}=`
  if (!flag.startsWith(prefix)) return []
  return flag
    .slice(prefix.length)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function hasFeature(
  flags: string[],
  switchName: string,
  feature: string
): boolean {
  return flags.some((flag) => featureList(flag, switchName).includes(feature))
}

// Merge dark-mode defaults into an existing BrowserConfig without overriding
// explicit user choices. Flags are de-duplicated preserving user order.
// excludeBrowserFlags opts out of the stock appearance defaults: listing
// `--force-dark-mode` drops the whole bundle (Chromium flags and Gecko prefs).
export function withDarkMode<T extends BrowserConfig & {browser: BrowserType}>(
  config: T
): T {
  const defaults = getDarkModeDefaults(config.browser)
  const excludeFlags = (config.excludeBrowserFlags || []).map(normalizeFlag)
  const appearanceOptedOut = isFlagExcluded('--force-dark-mode', excludeFlags)

  const existingFlags = Array.isArray(config.browserFlags)
    ? config.browserFlags.map(normalizeFlag)
    : []
  const nextFlags = [...existingFlags]

  if (!appearanceOptedOut) {
    for (const flag of defaults.browserFlags || []) {
      if (isFlagExcluded(flag, excludeFlags)) continue
      if (nextFlags.some((existing) => existing === flag)) continue

      if (flag.startsWith('--enable-features=')) {
        const feature = flag.slice('--enable-features='.length)
        // A user --disable-features listing this name is an explicit no.
        if (hasFeature(nextFlags, '--disable-features', feature)) continue
        const enableIndex = nextFlags.findIndex((existing) =>
          existing.startsWith('--enable-features=')
        )
        // Fold into the caller's switch so we never append a second
        // --enable-features that would replace theirs on Chromium.
        if (enableIndex >= 0) {
          if (!hasFeature(nextFlags, '--enable-features', feature)) {
            nextFlags[enableIndex] = `${nextFlags[enableIndex]},${feature}`
          }
          continue
        }
      }

      nextFlags.push(flag)
    }
  }

  const userPreferences = config.preferences || {}
  const nextPreferences = {
    ...userPreferences,
    ...Object.fromEntries(
      Object.entries(defaults.preferences || {}).filter(
        ([key]) => !(key in userPreferences) && !appearanceOptedOut
      )
    )
  }

  return {
    ...config,
    browserFlags: nextFlags,
    preferences: nextPreferences
  }
}
