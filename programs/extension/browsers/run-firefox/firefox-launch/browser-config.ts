// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {humanLine, isDebug} from '../../../helpers/messaging'
import * as messages from '../../browsers-lib/messages'
import {resolveProfileConfig} from '../../browsers-lib/resolve-profile'
import {
  cleanupOldTempProfiles,
  filterBrowserFlags,
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

export interface FirefoxLaunchConfig {
  // '' when the browser's own profile is used (no -profile argument).
  profilePath: string
  // The user's flags plus the starting URL, in the order the binary gets them.
  binaryArgs: string[]
  // The legacy `--binary-args=".." --profile=".." --verbose` string.
  config: string
}

export interface FirefoxConfigMode {
  // false composes the same decision without creating the profile or writing
  // user.js, for a dry run that must print the plan and touch nothing.
  provision?: boolean
}

// The legacy string form; the launcher reads the structured result so it
// never re-parses this.
export async function browserConfig(
  compilation: CompilationLike,
  configOptions: BrowserConfigOptions
) {
  return (await resolveFirefoxLaunchConfig(compilation, configOptions)).config
}

export async function resolveFirefoxLaunchConfig(
  compilation: CompilationLike,
  configOptions: BrowserConfigOptions,
  mode: FirefoxConfigMode = {}
): Promise<FirefoxLaunchConfig> {
  const provision = mode.provision !== false
  const {browser, profile, browserFlags = []} = configOptions
  const binaryArgs: string[] = []
  // Shared semantics with the chromium launcher: exact or switch-prefix
  // (=/,) matching, applied to the user flag layer.
  const excludeFlags = configOptions.excludeBrowserFlags || []
  const filteredFlags = filterBrowserFlags(
    (browserFlags || []).map(String),
    excludeFlags
  )

  if (filteredFlags.length > 0) {
    binaryArgs.push(...filteredFlags)
  }

  // Environment escape hatch (see parseEnvBrowserFlags): appended after config
  // browserFlags and NOT subject to excludeBrowserFlags. The env is explicit.
  binaryArgs.push(...parseEnvBrowserFlags(process.env.EXTENSION_BROWSER_FLAGS))

  // Firefox accepts a URL as the last argument (parity with Chromium's
  // startingUrl). Deliberately unquoted; the caller wraps the args string.
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

  // One shared decision about what profile this run gets; the launcher only
  // expresses the result as a Firefox --profile.
  const resolved = resolveProfileConfig({
    rawProfile: profile,
    managedBaseDir,
    useSystemProfile,
    persistProfile: (configOptions as {persistProfile?: boolean})
      .persistProfile,
    keepProfileChanges: configOptions.keepProfileChanges,
    copyFromProfile: configOptions.copyFromProfile,
    // Resolve relative profile paths against the compilation context, not cwd():
    // otherwise sequential examples collapse onto one shared profile.
    resolveExplicit: (trimmedProfile) =>
      path.isAbsolute(trimmedProfile)
        ? trimmedProfile
        : path.resolve(contextDir, trimmedProfile),
    provision
  })

  const profilePath: string = resolved.profilePath

  if (resolved.kind === 'managed' && provision) {
    // Profile provisioning is an internal step; surface it only under --debug.
    if (isDebug())
      humanLine(messages.creatingUserProfile(shownPath(profilePath)))

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
        // Ignore
      }
    }
  }

  if (profilePath && provision) {
    try {
      fs.mkdirSync(profilePath, {recursive: true})
    } catch {
      // Ignore
    }

    // A pinned/persisted profile can serve STALE extension code out of Firefox's
    // startupCache across a full dev restart; the cache is always safe to drop.
    try {
      fs.rmSync(path.join(profilePath, 'startupCache'), {
        recursive: true,
        force: true
      })
    } catch {
      // best-effort; a locked live profile keeps its cache
    }
  }

  if (profilePath && provision) {
    try {
      const prefs = getPreferences(configOptions?.preferences || {})

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
      // Ignore
    }
  }

  const parts = ['--verbose']
  if (binaryArgs.length > 0) {
    parts.unshift(`--binary-args="${binaryArgs.join(' ')}"`)
  }
  if (profilePath) {
    parts.splice(1, 0, `--profile="${profilePath}"`)
  }
  return {profilePath, binaryArgs, config: parts.join(' ')}
}
