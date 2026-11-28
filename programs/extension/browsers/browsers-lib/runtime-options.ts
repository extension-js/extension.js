// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {BrowserConfig, PluginInterface} from '../browsers-types'

export const sharedBrowserRuntimeOptionKeys = [
  'extension',
  'browser',
  'noOpen',
  'browserFlags',
  'excludeBrowserFlags',
  'profile',
  'persistProfile',
  'keepProfileChanges',
  'copyFromProfile',
  'preferences',
  'startingUrl',
  'instanceId',
  'port',
  'dryRun',
  'logLevel',
  'logContexts',
  'logFormat',
  'logTimestamps',
  'logColor',
  'logUrl',
  'logTab'
] as const satisfies readonly (keyof PluginInterface)[]

export type SharedBrowserRuntimeOptions = Pick<
  PluginInterface,
  (typeof sharedBrowserRuntimeOptionKeys)[number]
>

export function pickSharedBrowserRuntimeOptions(
  options: SharedBrowserRuntimeOptions
): SharedBrowserRuntimeOptions {
  return sharedBrowserRuntimeOptionKeys.reduce((picked, key) => {
    ;(picked as Record<string, unknown>)[key] = (
      options as unknown as Record<string, unknown>
    )[key]

    return picked
  }, {} as SharedBrowserRuntimeOptions)
}

// What a launch opens while the starting URL waits for the extension: a page
// loaded before the install never gets its document_start content scripts.
export const LAUNCH_TAB_URL = 'about:blank'

// Firefox reads a tab an add-on just opened as about:blank until it loads,
// so the launch tab carries a fragment that no other tab has.
export const FIREFOX_LAUNCH_TAB_URL = `${LAUNCH_TAB_URL}#extension-js-launch`

// --no-open means open nothing at all, so it suppresses the starting URL the
// same way it suppresses the courtesy new-tab. Every family reads the launch
// URL through here so the two readings can never drift apart again.
export function resolveStartingUrl(options: {
  startingUrl?: string
  noOpen?: boolean
}): string | undefined {
  if (options.noOpen) return undefined

  return options.startingUrl
}

export type BrowserLaunchRequestSource = Pick<
  PluginInterface,
  | 'browser'
  | 'browserFlags'
  | 'excludeBrowserFlags'
  | 'profile'
  | 'persistProfile'
  | 'keepProfileChanges'
  | 'copyFromProfile'
  | 'preferences'
  | 'startingUrl'
  | 'noOpen'
  | 'port'
>

export type BrowserLaunchRequest = Pick<
  PluginInterface & BrowserConfig,
  | 'browser'
  | 'browserFlags'
  | 'excludeBrowserFlags'
  | 'profile'
  | 'persistProfile'
  | 'keepProfileChanges'
  | 'copyFromProfile'
  | 'preferences'
  | 'startingUrl'
  | 'noOpen'
  | 'port'
> & {
  mode: 'development' | 'production' | 'none'
}

export function buildBrowserLaunchRequest<T extends object = object>(
  options: BrowserLaunchRequestSource,
  mode: 'development' | 'production' | 'none',
  extras?: T
): BrowserLaunchRequest & T {
  return {
    browser: options.browser,
    browserFlags: options.browserFlags || [],
    excludeBrowserFlags: options.excludeBrowserFlags || [],
    profile: options.profile,
    persistProfile: options.persistProfile,
    keepProfileChanges: options.keepProfileChanges,
    copyFromProfile: options.copyFromProfile,
    preferences: options.preferences || {},
    startingUrl: options.startingUrl,
    noOpen: options.noOpen,
    port: options.port,
    mode,
    ...(extras || ({} as T))
  }
}

// A binary pinned under another browser's name is still what it is: Edge
// shows an "Installed theme, Undo" bar for the built-in theme, Opera and
// Yandex refuse it. The session's browser name cannot tell, the binary's own
// path can: the version line is read under the session's name, so a pinned
// Edge answers there as "Chromium".
const THEME_REFUSING_BINARY =
  /(^|[\\/])(microsoft[ -]edge[^\\/]*|msedge(\.exe)?|opera[^\\/]*|yandex[^\\/]*)$/i

export function withoutThemeForBinary(
  extensions: string[],
  binaryPath: string | undefined
): string[] {
  if (!THEME_REFUSING_BINARY.test(String(binaryPath || '').trim())) {
    return extensions
  }

  return extensions.filter(
    (extensionPath) =>
      !String(extensionPath).split(/[\\/]/).includes('extension-js-theme')
  )
}

export function toExtensionLoadList(
  extension: PluginInterface['extension']
): string[] {
  return Array.isArray(extension) ? [...extension] : [extension]
}
