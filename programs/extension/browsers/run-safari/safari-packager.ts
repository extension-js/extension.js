// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {BrowserLogger} from '../browsers-types'
import {
  packageSafariExtension,
  type SafariPackageResult,
  type SafariPipelineMode
} from './safari-launch'

/**
 * Identity overrides develop resolves per build (CLI flags merged with
 * `extension.config.js` `browser.safari`) and hands to the packager.
 */
export interface SafariPackagerOverrides {
  appName?: string
  bundleId?: string
  macOsOnly?: boolean
  forceRegenerate?: boolean
  safariBinary?: string
  /** When set, overrides the factory `noOpen` for this packaging call. */
  noOpen?: boolean
}

export interface SafariPackagerOptions extends SafariPackagerOverrides {
  /** 'safari' or 'webkit-based'. Defaults to 'safari'. */
  browser?: 'safari' | 'webkit-based'
  /** Skip opening the packaged app. Defaults to true: packaging is not launching. */
  noOpen?: boolean
  /** Print the commands instead of running them. */
  dryRun?: boolean
  logger?: BrowserLogger
}

export type SafariPackagerFn = (
  distPath: string,
  mode?: SafariPipelineMode,
  overrides?: SafariPackagerOverrides
) => Promise<SafariPackageResult>

// An override that was never set must not erase a value the caller configured
// on the factory, and develop always sends the full override record with
// `undefined` in the slots the user left alone.
function withoutUndefined<T extends object>(input?: T): Partial<T> {
  if (!input) return {}
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

/**
 * Builds the `safariPackager` callback `extensionBuild`/`extensionDev` accept.
 * Without it a library caller that asks for `browser: 'safari'` gets a plain
 * dist and no app at all, because develop deliberately owns no Xcode code and
 * only packages when a packager is injected.
 */
export function createSafariPackager(
  options: SafariPackagerOptions = {}
): SafariPackagerFn {
  const {
    browser = 'safari',
    noOpen = true,
    dryRun = false,
    logger,
    ...identity
  } = options

  return async (distPath, mode = 'full', overrides) =>
    await packageSafariExtension(
      {
        extension: [distPath],
        browser,
        noOpen,
        dryRun,
        ...withoutUndefined(identity),
        ...withoutUndefined(overrides)
      },
      distPath,
      logger,
      mode
    )
}
