// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {type Compilation} from '@rspack/core'
import {
  type PluginInterface,
  type DefaultBrowserFlags
} from '../../browsers-types'
import {
  filterBrowserFlags,
  deriveDebugPortWithInstance
} from '../../browsers-lib/shared-utils'
import {cleanupOldTempProfiles} from '../../browsers-lib/shared-utils'
import * as messages from '../../browsers-lib/messages'
import {
  chromeMasterPreferences,
  edgeMasterPreferences
} from './master-preferences'
import {
  uniqueNamesGenerator,
  adjectives,
  colors as ucColors,
  animals
} from 'unique-names-generator'

// Define the default flags as a constant for maintainability and type checking
// Removed redundant and outdated flags for better performance
export const DEFAULT_BROWSER_FLAGS: DefaultBrowserFlags[] = [
  // Disable Chrome's native first run experience.
  '--no-first-run',
  // Disables client-side phishing detection
  '--disable-client-side-phishing-detection',
  // Disable sync to keep UI minimal and avoid account prompts
  '--disable-sync',
  // Disable some built-in extensions that aren't affected by '--disable-extensions'
  '--disable-component-extensions-with-background-pages',
  // Disable installation of default apps
  '--disable-default-apps',
  // Disables the Discover feed on NTP
  '--disable-features=InterestFeedContentSuggestions',
  // Disables Chrome translation, both the manual option and the popup prompt when a
  // page with differing language is detected.
  '--disable-features=Translate',
  // Hide scrollbars from screenshots.
  '--hide-scrollbars',
  // Mute any audio
  '--mute-audio',
  // Disable the default browser check, do not prompt to set it as such
  '--no-default-browser-check',
  // Avoids blue bubble "user education" nudges
  // (eg., "... give your browser a new look", Memory Saver)
  '--ash-no-nudges',
  // Disable the 2023+ search engine choice screen
  '--disable-search-engine-choice-screen',
  // Avoid the startup dialog for
  // `Do you want the application "Chromium.app" to accept incoming network connections?`.
  // Also disables the Chrome Media Router which creates background networking activity
  // to discover cast targets.
  '--disable-features=MediaRoute',
  // Use mock keychain on Mac to prevent the blocking permissions dialog about
  // "Chrome wants to use your confidential information stored in your keychain"
  '--use-mock-keychain',
  // Disable various background network services, including extension updating,
  // safe browsing service, upgrade detector, translate, UMA
  '--disable-background-networking',
  // Disable crashdump collection (reporting is already disabled in Chromium)
  '--disable-breakpad',
  // Don't update the browser 'components' listed at chrome://components/
  '--disable-component-update',
  // Disables Domain Reliability Monitoring, which tracks whether the browser
  // has difficulty contacting Google-owned sites and uploads reports to Google.
  '--disable-domain-reliability',
  // Disable syncing to a Google account
  '--disable-sync',
  // Don't send hyperlink auditing pings
  '--no-pings',
  // Ensure the side panel is visible. This is used for testing the side panel feature.
  '--enable-features=SidePanelUpdates',
  // Disable the load extension command line switch
  // @ts-expect-error - this is a valid flag
  '--disable-features=DisableLoadExtensionCommandLineSwitch'
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function deepMergePreferences(
  base: Record<string, unknown>,
  custom: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {...base}

  for (const [key, value] of Object.entries(custom)) {
    const current = merged[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = deepMergePreferences(current, value)
      continue
    }
    merged[key] = value
  }

  return merged
}

function getChromiumMasterPreferences(
  browser: PluginInterface['browser']
): Record<string, unknown> {
  return browser === 'edge' ? edgeMasterPreferences : chromeMasterPreferences
}

function seedChromiumPreferences(
  profilePath: string,
  browser: PluginInterface['browser'],
  customPreferences: unknown
) {
  const preferencesPath = path.join(profilePath, 'Default', 'Preferences')
  if (fs.existsSync(preferencesPath)) return

  const basePreferences = getChromiumMasterPreferences(browser)
  const custom = isPlainObject(customPreferences) ? customPreferences : {}
  const mergedPreferences = deepMergePreferences(basePreferences, custom)

  fs.mkdirSync(path.dirname(preferencesPath), {recursive: true})
  fs.writeFileSync(preferencesPath, JSON.stringify(mergedPreferences), 'utf8')
}

export function browserConfig(
  compilation: Compilation,
  configOptions: PluginInterface
) {
  const extensionsToLoad = Array.isArray(configOptions.extension)
    ? configOptions.extension
    : [configOptions.extension]

  // Use ephemeral profile under dist unless explicit profile provided
  const sourceEnabled = !!(configOptions.source || configOptions.watchSource)
  const devWantsCDP = compilation?.options?.mode === 'development'
  const rawProfile = configOptions.profile
  const hasExplicitProfile =
    typeof rawProfile === 'string' && rawProfile.trim().length > 0
  const useSystemProfile =
    String(
      process.env.EXTENSION_USE_SYSTEM_PROFILE ||
        process.env.EXTJS_USE_SYSTEM_PROFILE ||
        ''
    )
      .toLowerCase()
      .trim() === 'true'

  let userProfilePath: string

  const contextDir = compilation?.options?.context || process.cwd()

  const shownPath = (p: string) => {
    try {
      const rel = path.relative(contextDir, p)
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p
    } catch {
      return p
    }
  }

  if (hasExplicitProfile) {
    userProfilePath = path.resolve(rawProfile.trim())
  } else if (!useSystemProfile) {
    const outPath =
      compilation?.options?.output?.path ||
      path.resolve(process.cwd(), 'dist/chrome')
    const distRoot = path.dirname(outPath)
    const base = path.resolve(
      distRoot,
      'extension-js',
      'profiles',
      `${configOptions.browser}-profile`
    )
    const persist = Boolean(configOptions.persistProfile)

    if (persist) {
      const stableDir = path.join(base, 'dev')

      // Visual hint while creating persistent dev profile
      // eslint-disable-next-line no-console
      console.log(
        messages.creatingUserProfile(
          hasExplicitProfile ? stableDir : shownPath(stableDir)
        )
      )
      fs.mkdirSync(stableDir, {recursive: true})
      userProfilePath = stableDir
    } else {
      const human = uniqueNamesGenerator({
        dictionaries: [adjectives, ucColors, animals],
        separator: '-',
        length: 3
      })
      const ephemDir = path.join(base, human)

      // Visual hint while creating ephemeral temp profile
      // eslint-disable-next-line no-console
      console.log(
        messages.creatingUserProfile(
          hasExplicitProfile ? ephemDir : shownPath(ephemDir)
        )
      )
      fs.mkdirSync(ephemDir, {recursive: true})
      userProfilePath = ephemDir

      // Best-effort cleanup of old tmp-* profiles; exclude current basename
      try {
        const maxAgeHours = parseInt(
          String(process.env.EXTENSION_TMP_PROFILE_MAX_AGE_HOURS || ''),
          10
        )
        cleanupOldTempProfiles(
          base,
          path.basename(ephemDir),
          Number.isFinite(maxAgeHours) ? maxAgeHours : 12
        )
      } catch {
        // ignore
      }
    }
  } else {
    userProfilePath = ''
  }

  // Seed Chromium profile preferences once for managed/explicit profile paths.
  // This ensures extension developer mode defaults are present on fresh runs.
  if (userProfilePath) {
    try {
      fs.mkdirSync(userProfilePath, {recursive: true})
      seedChromiumPreferences(
        userProfilePath,
        configOptions.browser,
        configOptions.preferences
      )
    } catch {
      // best-effort only
    }
  }

  // Get excluded flags (if any)
  const excludeFlags = configOptions.excludeBrowserFlags || []

  // Filter out excluded flags
  const filteredFlags = filterBrowserFlags(DEFAULT_BROWSER_FLAGS, excludeFlags)

  // Source inspection toggles remote debugging flags
  // Compute instance-based CDP port using shared helper
  const cdpPort = deriveDebugPortWithInstance(
    configOptions.port,
    configOptions.instanceId
  )

  // Enhanced flags for AI usage - ensure clean termination
  const aiOptimizedFlags = [
    // AI-optimized flags for better process management
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=TranslateUI',

    // Ensure clean shutdown
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',

    // Memory management for AI usage
    '--memory-pressure-off',
    '--max_old_space_size=4096',
    '--disable-dev-shm-usage'
  ]

  // Flags set by default:
  // https://github.com/GoogleChrome/chrome-launcher/blob/master/src/flags.ts
  // Added useful flags for tooling:
  // Ref: https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
  const baseFlags = [
    `--load-extension=${extensionsToLoad.join()}`,
    ...(userProfilePath ? [`--user-data-dir=${userProfilePath}`] : []),
    ...aiOptimizedFlags,
    ...(sourceEnabled || devWantsCDP
      ? [
          `--remote-debugging-port=${cdpPort}`,
          '--remote-debugging-address=127.0.0.1'
        ]
      : []),
    ...filteredFlags,
    ...(configOptions.browserFlags || [])
  ]

  return baseFlags
}
