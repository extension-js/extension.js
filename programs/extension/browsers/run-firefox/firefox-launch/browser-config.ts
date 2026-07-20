// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as messages from '../../browsers-lib/messages'
import {resolveProfileConfig} from '../../browsers-lib/resolve-profile'
import {
  cleanupOldTempProfiles,
  parseEnvBrowserFlags
} from '../../browsers-lib/shared-utils'
import type {
  BrowserConfig,
  BrowserType,
  CompilationLike
} from '../../browsers-types'
import {getPreferences} from './master-preferences'

type BrowserConfigOptions = {
  browser: BrowserType
  mode: 'development' | 'production' | 'none'
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  profile?: string | false
  preferences?: Record<string, unknown>
  startingUrl?: string
  port?: number | string
  noOpen?: boolean
} & BrowserConfig & {
    keepProfileChanges?: boolean
    copyFromProfile?: string
    instanceId?: string
  }

export async function browserConfig(
  compilation: CompilationLike,
  configOptions: BrowserConfigOptions
) {
  const {browser, profile, browserFlags = []} = configOptions
  const binaryArgs: string[] = []
  const excludeFlags = configOptions.excludeBrowserFlags || []
  const filteredFlags = (browserFlags || []).filter((flag) =>
    excludeFlags.every((ex: string) => !String(flag).startsWith(ex))
  )

  if (filteredFlags.length > 0) {
    binaryArgs.push(...filteredFlags)
  }

  // Environment escape hatch (see parseEnvBrowserFlags): appended after config
  // browserFlags and NOT subject to excludeBrowserFlags. The env is explicit.
  binaryArgs.push(...parseEnvBrowserFlags(process.env.EXTENSION_BROWSER_FLAGS))

  // Firefox supports being launched with an URL as the last argument.
  // This keeps parity with Chromium, where we append `startingUrl` on spawn.
  //
  // Note: we intentionally do not quote here; the caller already wraps the
  // entire binary args string in quotes. URLs should not contain spaces.
  if (configOptions.startingUrl && !configOptions.noOpen) {
    binaryArgs.push('--url', String(configOptions.startingUrl))
  }

  const outPath =
    compilation.options.output?.path ||
    path.resolve(process.cwd(), 'dist/firefox')
  const distRoot = path.dirname(outPath)
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

  const managedBaseDir = path.resolve(
    distRoot,
    'extension-js',
    'profiles',
    `${browser}-profile`
  )

  // One shared decision about what profile this run gets (system / explicit /
  // managed), including copyFromProfile seeding and keepProfileChanges
  // persistence. The launcher only expresses the result as a Firefox --profile.
  const resolved = resolveProfileConfig({
    rawProfile: profile,
    managedBaseDir,
    useSystemProfile,
    persistProfile: (configOptions as {persistProfile?: boolean})
      .persistProfile,
    keepProfileChanges: configOptions.keepProfileChanges,
    copyFromProfile: configOptions.copyFromProfile,
    // Resolve relative profile paths against the rspack compilation context
    // (the project root that owns extension.config.js), not process.cwd().
    // Otherwise running examples sequentially from a parent dir collapses
    // every example to the same shared profile.
    resolveExplicit: (trimmedProfile) =>
      path.isAbsolute(trimmedProfile)
        ? trimmedProfile
        : path.resolve(contextDir, trimmedProfile)
  })

  const profilePath: string = resolved.profilePath

  if (resolved.kind === 'managed') {
    // Visual hint while creating managed (persistent or ephemeral) profile
    // eslint-disable-next-line no-console
    console.log(messages.creatingUserProfile(shownPath(profilePath)))

    if (!resolved.persisted) {
      try {
        const maxAgeHours = parseInt(
          String(process.env.EXTENSION_TMP_PROFILE_MAX_AGE_HOURS || ''),
          10
        )
        cleanupOldTempProfiles(
          managedBaseDir,
          path.basename(profilePath),
          Number.isFinite(maxAgeHours) ? maxAgeHours : 12
        )
      } catch {
        // ignore
      }
    }
  }

  // Ensure profile directory exists for explicit/managed profiles.
  if (profilePath) {
    try {
      fs.mkdirSync(profilePath, {recursive: true})
    } catch {
      // ignore
    }
  }

  // Best-effort: clear crash/sessionstore artifacts for managed profiles.
  // This avoids "restore session" prompts after fast terminate/restart loops.
  // Write Firefox profile preferences (user.js) to enable RDP and unsigned add-ons.
  if (profilePath) {
    try {
      const prefs = getPreferences(configOptions?.preferences || {})

      // Helper to serialize a single value for user.js
      function serializeValue(value: unknown): string {
        if (typeof value === 'string') {
          return JSON.stringify(value)
        }
        if (typeof value === 'boolean') {
          return String(value)
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return String(value)
        }
        return JSON.stringify(value)
      }

      // Convert preferences object to user.js file format
      function prefsToUserJs(prefsObject: Record<string, unknown>): string {
        return Object.entries(prefsObject)
          .map(([key, val]) => {
            return `user_pref(${JSON.stringify(key)}, ${serializeValue(val)});`
          })
          .join('\n')
      }

      const userJsPath = path.join(profilePath, 'user.js')
      const userJsContent = prefsToUserJs(prefs)
      fs.writeFileSync(userJsPath, userJsContent)
    } catch {
      // best-effort
    }
  }

  const parts = ['--verbose']
  if (binaryArgs.length > 0) {
    parts.unshift(`--binary-args="${binaryArgs.join(' ')}"`)
  }
  if (profilePath) {
    parts.splice(1, 0, `--profile="${profilePath}"`)
  }
  return parts.join(' ')
}
