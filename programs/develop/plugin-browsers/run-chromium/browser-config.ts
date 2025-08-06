import {Compilation, type Compiler} from '@rspack/core'
import {type PluginInterface, type DefaultBrowserFlags} from '../browsers-types'
import {createProfile} from './create-profile'
import {filterBrowserFlags} from '../browsers-lib/shared-utils'

// Define the default flags as a constant for maintainability and type checking
// Removed redundant and outdated flags for better performance
export const DEFAULT_BROWSER_FLAGS: DefaultBrowserFlags[] = [
  // Disable Chrome's native first run experience.
  '--no-first-run',
  // Disables client-side phishing detection
  '--disable-client-side-phishing-detection',
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
  // (eg., "… give your browser a new look", Memory Saver)
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

export function browserConfig(
  compilation: any,
  configOptions: PluginInterface
) {
  const extensionsToLoad = Array.isArray(configOptions.extension)
    ? configOptions.extension
    : [configOptions.extension]

  const actualCompilation = compilation.compilation || compilation

  const userProfilePath = createProfile(actualCompilation, {
    browser: configOptions.browser,
    userProfilePath: configOptions.profile,
    configPreferences: configOptions.preferences
  })

  // Get excluded flags (if any)
  const excludeFlags = configOptions.excludeBrowserFlags || []

  // Filter out excluded flags
  const filteredFlags = filterBrowserFlags(DEFAULT_BROWSER_FLAGS, excludeFlags)

  // Flags set by default:
  // https://github.com/GoogleChrome/chrome-launcher/blob/master/src/flags.ts
  // Added useful flags for tooling:
  // Ref: https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md

  const baseFlags = [
    `--load-extension=${extensionsToLoad.join()}`,
    `--user-data-dir=${userProfilePath}`,
    ...filteredFlags,
    // Flags to pass to Chrome
    // Any of http://peter.sh/experiments/chromium-command-line-switches/
    ...(configOptions.browserFlags || [])
  ]

  return baseFlags
}
