// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
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
// A relative appIcon is read from the project, the folder extension.config.js
// lives in, so the same line works from any working directory.
export function resolveSafariIdentity(
  merged: SafariIdentity,
  projectDir: string = process.cwd()
): SafariIdentity {
  if (merged.bundleId && !isValidBundleId(merged.bundleId)) {
    throw new Error(messages.safariInvalidBundleId(merged.bundleId))
  }

  const iconPath = String(merged.appIcon || '').trim()
  const appIcon = iconPath ? path.resolve(projectDir, iconPath) : undefined

  if (appIcon && !fs.existsSync(appIcon)) {
    throw new Error(messages.safariAppIconNotFound(appIcon))
  }

  return {
    appName: merged.appName,
    bundleId: merged.bundleId,
    developmentTeam: merged.developmentTeam,
    macOsOnly: merged.macOsOnly,
    appIcon,
    forceRegenerate: merged.forceRegenerate,
    safariBinary: merged.safariBinary
  }
}
