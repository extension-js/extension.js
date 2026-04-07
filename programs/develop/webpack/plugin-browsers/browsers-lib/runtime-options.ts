// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {BrowserConfig, DevOptions} from '../../webpack-types'
import type {PluginInterface} from '../browsers-types'

export const sharedBrowserRuntimeOptionKeys = [
  'extension',
  'browser',
  'noOpen',
  'browserFlags',
  'excludeBrowserFlags',
  'profile',
  'preferences',
  'startingUrl',
  'instanceId',
  'port',
  'source',
  'watchSource',
  'sourceFormat',
  'sourceSummary',
  'sourceMeta',
  'sourceProbe',
  'sourceTree',
  'sourceConsole',
  'sourceDom',
  'sourceMaxBytes',
  'sourceRedact',
  'sourceIncludeShadow',
  'sourceDiff',
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
    picked[key] = options[key]
    return picked
  }, {} as SharedBrowserRuntimeOptions)
}

export type BrowserLaunchRequestSource = Pick<
  PluginInterface,
  | 'browser'
  | 'browserFlags'
  | 'excludeBrowserFlags'
  | 'profile'
  | 'preferences'
  | 'startingUrl'
  | 'port'
>

export type BrowserLaunchRequest = Pick<
  DevOptions & BrowserConfig,
  | 'browser'
  | 'browserFlags'
  | 'excludeBrowserFlags'
  | 'profile'
  | 'preferences'
  | 'startingUrl'
  | 'port'
> & {
  mode: DevOptions['mode']
}

export function buildBrowserLaunchRequest<T extends object = {}>(
  options: BrowserLaunchRequestSource,
  mode: DevOptions['mode'],
  extras?: T
): BrowserLaunchRequest & T {
  return {
    browser: options.browser,
    browserFlags: options.browserFlags,
    excludeBrowserFlags: options.excludeBrowserFlags,
    profile: options.profile,
    preferences: options.preferences,
    startingUrl: options.startingUrl,
    port: options.port,
    mode,
    ...(extras || ({} as T))
  }
}

export function toExtensionLoadList(
  extension: PluginInterface['extension']
): string[] {
  return Array.isArray(extension) ? [...extension] : [extension]
}

export function publishUserExtensionRoot(
  extension: PluginInterface['extension'],
  setExtensionRoot?: (root?: string) => void
) {
  try {
    const root = [...toExtensionLoadList(extension)]
      .reverse()
      .find((entry) => typeof entry === 'string')

    if (root && setExtensionRoot) {
      setExtensionRoot(String(root))
    }
  } catch {
    // Ignore best-effort root publication failures.
  }
}
