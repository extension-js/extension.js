// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as messages from '../../browsers-lib/messages'
import {resolveProfileConfig} from '../../browsers-lib/resolve-profile'
import {toExtensionLoadList} from '../../browsers-lib/runtime-options'
import {
  cleanupOldTempProfiles,
  deriveDebugPortWithInstance,
  filterBrowserFlags,
  isHeadlessGuardRequested,
  mergeChromiumFeatureSwitches,
  parseEnvBrowserFlags,
  prepareChromiumProfileForLaunch
} from '../../browsers-lib/shared-utils'
import type {
  CompilationLike,
  DefaultBrowserFlags,
  PluginInterface
} from '../../browsers-types'
import {
  chromeMasterPreferences,
  edgeMasterPreferences
} from './master-preferences'

export const DEFAULT_BROWSER_FLAGS: DefaultBrowserFlags[] = [
  '--no-first-run',
  '--disable-client-side-phishing-detection',
  '--disable-sync',
  // Disable some built-in extensions that aren't affected by '--disable-extensions'
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  // Disables the Discover feed on NTP
  '--disable-features=InterestFeedContentSuggestions',
  // Disables Chrome translation, both the manual option and the popup prompt when a
  // page with differing language is detected.
  '--disable-features=Translate',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-default-browser-check',
  // Avoids blue bubble "user education" nudges
  // (eg., "... give your browser a new look", Memory Saver)
  '--ash-no-nudges',
  '--disable-search-engine-choice-screen',
  // Avoid the macOS incoming-connections dialog and disable the Chrome Media
  // Router's background cast-discovery networking.
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
  '--disable-sync',
  // Don't send hyperlink auditing pings
  '--no-pings',
  // Ensure the side panel is visible. This is used for testing the side panel feature.
  '--enable-features=SidePanelUpdates',
  // Disable the load extension command line switch
  // @ts-expect-error - this is a valid flag
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  // Chromium 152+ disables unpacked developer extensions on the first
  // runtime.reload(), permanently killing the extension mid dev session.
  // @ts-expect-error - this is a valid flag
  '--disable-features=ExtensionDisableUnsupportedDeveloper',
  // Allow CDP-based extension management (Extensions.loadUnpacked, etc.)
  // Required since Chrome 126+ for reliable CDP extension operations
  '--enable-unsafe-extension-debugging',
  // Suppress the "X is debugging this browser" infobar so real logins
  // (claude.ai, Google, etc.) aren't pushed behind a persistent banner.
  '--silent-debugger-extension-api'
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
  compilation: CompilationLike,
  configOptions: PluginInterface
) {
  const extensionsToLoad = toExtensionLoadList(configOptions.extension)

  const devWantsCDP = compilation?.options?.mode === 'development'
  const rawProfile = configOptions.profile
  const useSystemProfile =
    String(
      process.env.EXTENSION_USE_SYSTEM_PROFILE ||
        process.env.EXTJS_USE_SYSTEM_PROFILE ||
        ''
    )
      .toLowerCase()
      .trim() === 'true'

  const contextDir = compilation?.options?.context || process.cwd()

  const shownPath = (p: string) => {
    try {
      const rel = path.relative(contextDir, p)
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p
    } catch {
      return p
    }
  }

  const outPath =
    compilation?.options?.output?.path ||
    path.resolve(process.cwd(), 'dist/chrome')
  const distRoot = path.dirname(outPath)
  const managedBaseDir = path.resolve(
    distRoot,
    'extension-js',
    'profiles',
    `${configOptions.browser}-profile`
  )

  // One shared decision about what profile this run gets; the launcher only
  // expresses the result as Chromium launch args.
  const resolved = resolveProfileConfig({
    rawProfile,
    managedBaseDir,
    useSystemProfile,
    persistProfile: configOptions.persistProfile,
    keepProfileChanges: configOptions.keepProfileChanges,
    copyFromProfile: configOptions.copyFromProfile,
    // Resolve relative profile paths against the compilation context, not cwd():
    // otherwise sequential examples collapse onto one shared profile.
    resolveExplicit: (trimmedProfile) =>
      path.isAbsolute(trimmedProfile)
        ? trimmedProfile
        : path.resolve(contextDir, trimmedProfile)
  })

  const userProfilePath = resolved.profilePath

  if (resolved.kind === 'managed') {
    // Visual hint while creating managed (persistent or ephemeral) profile
    // eslint-disable-next-line no-console
    console.log(messages.creatingUserProfile(shownPath(userProfilePath)))

    if (!resolved.persisted) {
      try {
        const maxAgeHours = parseInt(
          String(process.env.EXTENSION_TMP_PROFILE_MAX_AGE_HOURS || ''),
          10
        )
        cleanupOldTempProfiles(
          managedBaseDir,
          path.basename(userProfilePath),
          Number.isFinite(maxAgeHours) ? maxAgeHours : 12
        )
      } catch {
        // Ignore
      }
    }
  }

  // Seed Chromium profile preferences once for managed/explicit profile paths.
  // This ensures extension developer mode defaults are present on fresh runs.
  if (userProfilePath) {
    fs.mkdirSync(userProfilePath, {recursive: true})
    prepareChromiumProfileForLaunch(userProfilePath)
    try {
      seedChromiumPreferences(
        userProfilePath,
        configOptions.browser,
        configOptions.preferences
      )
    } catch {
      // Ignore
    }
  }

  const excludeFlags = configOptions.excludeBrowserFlags || []

  const filteredFlags = filterBrowserFlags(DEFAULT_BROWSER_FLAGS, excludeFlags)

  const cdpPort = deriveDebugPortWithInstance(
    configOptions.port,
    configOptions.instanceId
  )

  // Linux containers and CI often lack a usable setuid sandbox; without this
  // Chromium can exit before the debugging port binds.
  const isLinuxContainer =
    process.platform === 'linux' &&
    (process.env.CI === 'true' ||
      fs.existsSync('/.dockerenv') ||
      fs.existsSync('/run/.containerenv') ||
      process.env.REMOTE_CONTAINERS === 'true' ||
      process.env.CODESPACES === 'true' ||
      process.env.container != null)
  const linuxContainerSandboxFlags: string[] = isLinuxContainer
    ? ['--no-sandbox', '--disable-setuid-sandbox']
    : []

  const aiOptimizedFlags = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=TranslateUI',

    '--disable-hang-monitor',
    '--disable-prompt-on-repost',

    '--memory-pressure-off',
    '--max_old_space_size=4096',
    '--disable-dev-shm-usage'
  ]

  // Default flags: chrome-launcher's flags.ts; tooling flags per
  // chrome-flags-for-tools.md.
  const baseFlags = [
    ...(extensionsToLoad.length
      ? [`--load-extension=${extensionsToLoad.join()}`]
      : []),
    ...(userProfilePath ? [`--user-data-dir=${userProfilePath}`] : []),
    ...linuxContainerSandboxFlags,
    ...aiOptimizedFlags,
    ...(devWantsCDP
      ? [
          `--remote-debugging-port=${cdpPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-pipe'
        ]
      : []),
    ...filteredFlags,
    ...(configOptions.browserFlags || []),
    ...parseEnvBrowserFlags(process.env.EXTENSION_BROWSER_FLAGS)
  ]

  // Focus-steal guard: EXTENSION_HEADLESS=1 forces the headless backend for
  // automated sessions. Skipped when a --headless flavor was already passed
  // explicitly so config/env flag choices keep winning.
  if (
    isHeadlessGuardRequested() &&
    !baseFlags.some((flag) => flag.startsWith('--headless'))
  ) {
    baseFlags.push('--headless=new')
  }

  // Chromium only honors the last repeated --enable-features/--disable-features
  // switch, so merge them (defaults + user browserFlags) into one of each.
  return mergeChromiumFeatureSwitches(baseFlags)
}
