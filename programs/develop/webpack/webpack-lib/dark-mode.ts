// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type BrowserConfig, type BrowserType} from '../webpack-types'

// Returns cross-browser defaults to force dark mode.
// - Chromium/Edge: uses command-line flags to force dark UI.
// - Firefox/Gecko: writes user.js prefs to force dark UI and prefers-color-scheme.
export function getDarkModeDefaults(
  browser: BrowserType
): Pick<BrowserConfig, 'browserFlags' | 'preferences'> {
  // Chromium family → prefer flags for reliable behavior
  if (
    browser === 'chrome' ||
    browser === 'edge' ||
    browser === 'chromium' ||
    browser === 'chromium-based'
  ) {
    return {
      browserFlags: [
        '--force-dark-mode',
        // Enables dark styling for WebUI surfaces
        '--enable-features=WebUIDarkMode'
      ],
      preferences: {}
    }
  }

  // Firefox/Gecko → set UI + content color-scheme prefs
  // References:
  // - ui.systemUsesDarkTheme: 1 → dark, 0 → light
  // - layout.css.prefers-color-scheme.content-override:
  //   2 → dark, 1 → light, 0/3 → follow system/default
  if (
    browser === 'firefox' ||
    browser === 'gecko-based' ||
    browser === 'firefox-based'
  ) {
    return {
      browserFlags: [],
      preferences: {
        'ui.systemUsesDarkTheme': 1,
        'layout.css.prefers-color-scheme.content-override': 2,
        // Optional: make DevTools dark as well for consistency
        'devtools.theme': 'dark'
      }
    }
  }

  // Fallback (unknown browser types): no-ops
  return {
    browserFlags: [],
    preferences: {}
  }
}

/**
 * Merge dark-mode defaults into an existing BrowserConfig without overriding
 * explicit user choices. Flags are de-duplicated preserving user order.
 */
export function withDarkMode<T extends BrowserConfig & {browser: BrowserType}>(
  config: T
): T {
  const defaults = getDarkModeDefaults(config.browser)

  const existingFlags = Array.isArray(config.browserFlags)
    ? [...config.browserFlags]
    : []
  const nextFlags = [...existingFlags]

  for (const flag of defaults.browserFlags || []) {
    if (!nextFlags.some((f) => String(f).trim() === flag)) {
      nextFlags.push(flag)
    }
  }

  const nextPreferences = {
    ...(config.preferences || {}),
    // Only fill missing keys so callers can override any of them explicitly
    ...Object.fromEntries(
      Object.entries(defaults.preferences || {}).filter(
        ([k]) => !(k in (config.preferences || {}))
      )
    )
  }

  return {
    ...config,
    browserFlags: nextFlags,
    preferences: nextPreferences
  }
}
