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
  type SafariPipelineMode,
  type SafariPipelineTools
} from './safari-launch'

export interface SafariPackagerOverrides {
  appName?: string
  bundleId?: string
  macOsOnly?: boolean
  forceRegenerate?: boolean
  safariBinary?: string
  noOpen?: boolean
}

export interface SafariPackagerOptions extends SafariPackagerOverrides {
  browser?: 'safari' | 'webkit-based'
  announceDevReady?: boolean
  noOpen?: boolean
  dryRun?: boolean
  logger?: BrowserLogger
  tools?: SafariPipelineTools
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

export function createSafariPackager(
  options: SafariPackagerOptions = {}
): SafariPackagerFn {
  const {
    browser = 'safari',
    noOpen = true,
    dryRun = false,
    logger,
    tools,
    ...identity
  } = options

  return async (distPath, mode = 'full', overrides) =>
    await packageSafariExtension(
      {
        extension: [distPath],
        browser,
        noOpen,
        dryRun,
        tools,
        ...withoutUndefined(identity),
        ...withoutUndefined(overrides)
      },
      distPath,
      logger,
      mode
    )
}
