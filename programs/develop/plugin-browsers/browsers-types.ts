import {DevOptions} from '../commands/commands-lib/config-types'

/**
 * Default browser flags used by extension.js
 * These can be excluded using the excludeBrowserFlags option
 */
export type DefaultBrowserFlags =
  /**
   * Disable Chrome's native first run experience
   */
  | '--no-first-run'
  /**
   * Disables client-side phishing detection
   */
  | '--disable-client-side-phishing-detection'
  /**
   * Disable some built-in extensions that aren't affected by '--disable-extensions'
   */
  | '--disable-component-extensions-with-background-pages'
  /**
   * Disable installation of default apps
   */
  | '--disable-default-apps'
  /**
   * Disables the Discover feed on NTP
   */
  | '--disable-features=InterestFeedContentSuggestions'
  /**
   * Disables Chrome translation
   */
  | '--disable-features=Translate'
  /**
   * Hide scrollbars from screenshots
   */
  | '--hide-scrollbars'
  /**
   * Mute all audio in the browser
   */
  | '--mute-audio'
  /**
   * Disable the default browser check
   */
  | '--no-default-browser-check'
  /**
   * Avoids blue bubble "user education" nudges
   */
  | '--ash-no-nudges'
  /**
   * Disable the 2023+ search engine choice screen
   */
  | '--disable-search-engine-choice-screen'
  /**
   * Disable Chrome Media Router
   */
  | '--disable-features=MediaRoute'
  /**
   * Use mock keychain on Mac to prevent permissions dialog
   */
  | '--use-mock-keychain'
  /**
   * Disable various background network services
   */
  | '--disable-background-networking'
  /**
   * Disable crashdump collection
   */
  | '--disable-breakpad'
  /**
   * Don't update browser components
   */
  | '--disable-component-update'
  /**
   * Disable Domain Reliability Monitoring
   */
  | '--disable-domain-reliability'
  /**
   * Disable autofill server communication
   */
  | '--disable-features=AutofillServerCommunicatio'
  /**
   * Disable certificate transparency component updates
   */
  | '--disable-features=CertificateTransparencyComponentUpdate'
  /**
   * Disable syncing to a Google account
   */
  | '--disable-sync'
  /**
   * Disable the Chrome Optimization Guide
   */
  | '--disable-features=OptimizationHints'
  /**
   * Disable the MediaRouter feature (lighter version)
   */
  | '--disable-features=DialMediaRouteProvider'
  /**
   * Don't send hyperlink auditing pings
   */
  | '--no-pings'
  /**
   * Ensure the side panel is visible for testing
   */
  | '--enable-features=SidePanelUpdates'

export interface PluginInterface extends PluginOptions {
  browser: DevOptions['browser']
  extension: string | string[]
  port?: number
  // Internal auto-generated instance ID, not user-configurable
  instanceId?: string
}

export interface PluginOptions {
  open?: boolean
  browserFlags?: string[]
  /**
   * Array of browser flags to exclude from the default set
   * @example ['--hide-scrollbars', '--mute-audio']
   */
  excludeBrowserFlags?: Array<DefaultBrowserFlags | string>
  profile?: string
  preferences?: Record<string, any>
  startingUrl?: string
  browserConsole?: boolean
  devtools?: boolean
  chromiumBinary?: string
  geckoBinary?: string
}
