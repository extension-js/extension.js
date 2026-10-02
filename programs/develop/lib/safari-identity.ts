// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {SafariPackagerOverrides} from '../types'
import * as messages from './messages'

export type SafariIdentity = Omit<SafariPackagerOverrides, 'noOpen'>

// Apple's rule for CFBundleIdentifier: letters, digits, hyphens and periods.
// A segment may start with a digit (com.1password.ext), none may be empty.
export function isValidBundleId(value: string): boolean {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(value)
}

// The identity the packager gets, read off the fully merged option layers so a
// value from any config layer meets the same gate as the CLI flag.
export function resolveSafariIdentity(
  merged: SafariIdentity
): SafariIdentity {
  if (merged.bundleId && !isValidBundleId(merged.bundleId)) {
    throw new Error(messages.safariInvalidBundleId(merged.bundleId))
  }

  return {
    appName: merged.appName,
    bundleId: merged.bundleId,
    developmentTeam: merged.developmentTeam,
    macOsOnly: merged.macOsOnly,
    forceRegenerate: merged.forceRegenerate,
    safariBinary: merged.safariBinary
  }
}
