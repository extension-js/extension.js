import * as path from 'path'
import * as fs from 'fs'
import {Compilation} from '@rspack/core'
import {type DevOptions, type BrowserConfig} from '../../../../types/options'
import {cleanupOldTempProfiles} from '../../browsers-lib/shared-utils'
import * as messages from '../../browsers-lib/messages'
import {getPreferences} from './master-preferences'
import {
  uniqueNamesGenerator,
  adjectives,
  colors as ucColors,
  animals
} from 'unique-names-generator'

export async function browserConfig(
  compilation: Compilation,
  configOptions: DevOptions &
    BrowserConfig & {
      keepProfileChanges?: boolean
      copyFromProfile?: string
      instanceId?: string
    }
) {
  const {browser, profile, browserFlags = []} = configOptions
  const binaryArgs: string[] = []
  const excludeFlags = (configOptions as any).excludeBrowserFlags || []
  const filteredFlags = (browserFlags || []).filter((flag) =>
    excludeFlags.every((ex: string) => !String(flag).startsWith(ex))
  )

  if (filteredFlags.length > 0) {
    binaryArgs.push(...filteredFlags)
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

  let profilePath: string | ''

  const contextDir = compilation?.options?.context || process.cwd()
  const hasExplicitProfile =
    typeof profile === 'string' && profile.trim().length > 0

  const shownPath = (p: string) => {
    try {
      const rel = path.relative(contextDir, p)
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p
    } catch {
      return p
    }
  }

  if (typeof profile === 'string' && profile.trim().length > 0) {
    profilePath = path.resolve(profile.trim())
  } else if (!useSystemProfile) {
    const base = path.resolve(
      distRoot,
      'extension-js',
      'profiles',
      `${browser}-profile`
    )
    const persist = Boolean((configOptions as any).persistProfile)

    if (persist) {
      const stable = path.join(base, 'dev')

      // Visual hint while creating persistent dev profile
      // eslint-disable-next-line no-console
      console.log(
        messages.creatingUserProfile(
          hasExplicitProfile ? stable : shownPath(stable)
        )
      )

      profilePath = stable
    } else {
      const human = uniqueNamesGenerator({
        dictionaries: [adjectives, ucColors, animals],
        separator: '-',
        length: 3
      })
      const tmp = path.join(base, human)

      // Visual hint while creating ephemeral temp profile
      // eslint-disable-next-line no-console
      console.log(
        messages.creatingUserProfile(
          hasExplicitProfile ? tmp : shownPath(tmp)
        )
      )

      profilePath = tmp
    }

    fs.mkdirSync(profilePath, {recursive: true})

    // Write Firefox profile preferences (user.js) to enable RDP and unsigned add-ons
    try {
      const prefs = getPreferences((configOptions as any)?.preferences || {})

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

    try {
      const maxAgeHours = parseInt(
        String(process.env.EXTENSION_TMP_PROFILE_MAX_AGE_HOURS || ''),
        10
      )
      cleanupOldTempProfiles(
        base,
        path.basename(profilePath),
        Number.isFinite(maxAgeHours) ? maxAgeHours : 12
      )
    } catch {
      // ignore
    }
  } else {
    profilePath = ''
  }

  const parts = [`--binary-args="${binaryArgs.join(' ')}"`, '--verbose']
  if (profilePath) {
    parts.splice(1, 0, `--profile="${profilePath}"`)
  }
  return parts.join(' ')
}
