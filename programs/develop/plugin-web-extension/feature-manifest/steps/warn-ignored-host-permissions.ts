// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import {getOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'

const HOST_PERMISSION_KEYS = ['host_permissions', 'optional_host_permissions']

// The host grammar allows *, *.domain.tld, or a literal host. The port is
// not part of the host and may itself be a wildcard.
function hasInvalidHostWildcard(pattern: string): boolean {
  const authority = /^[a-zA-Z*]+:\/\/([^/]*)/.exec(pattern)?.[1]
  if (!authority) return false

  let host = authority

  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end !== -1) host = authority.slice(0, end + 1)
  } else {
    const colon = authority.indexOf(':')
    if (colon !== -1) host = authority.slice(0, colon)
  }

  if (!host.includes('*')) return false

  return host !== '*' && !/^\*\.[^*]+$/.test(host)
}

// Measured on Chrome 151 and Firefox Nightly 160: such a pattern loads and
// grants no host access, and Chrome records no error that would name it.
export function findIgnoredHostPermissionPatterns(
  manifest: unknown
): Array<{key: string; pattern: string}> {
  const found: Array<{key: string; pattern: string}> = []
  if (!manifest || typeof manifest !== 'object') return found

  for (const [key, list] of Object.entries(manifest)) {
    // A vendor prefix scopes the key to a browser and names the same list.
    const plain = key.substring(key.indexOf(':') + 1)

    if (!HOST_PERMISSION_KEYS.includes(plain) || !Array.isArray(list)) continue

    for (const pattern of list) {
      if (
        typeof pattern === 'string' &&
        pattern !== '<all_urls>' &&
        hasInvalidHostWildcard(pattern) &&
        !found.some((hit) => hit.key === key && hit.pattern === pattern)
      ) {
        found.push({key, pattern})
      }
    }
  }

  return found
}

export class WarnIgnoredHostPermissions {
  public static readonly name: string = 'manifest:warn-ignored-host-permissions'
  // A dev session re-reads the manifest on every save. One line per distinct
  // set of patterns is enough there, and production prints every build.
  private reported = new Set<string>()

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      WarnIgnoredHostPermissions.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: WarnIgnoredHostPermissions.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const original = getOriginalManifestContent(compilation)
            if (!original) return

            const hits = findIgnoredHostPermissionPatterns(
              parseJsonSafe(original)
            )
            if (!hits.length) return

            const signature = JSON.stringify(hits)

            if (compiler.options.mode === 'development') {
              if (this.reported.has(signature)) return

              this.reported.add(signature)
            }

            // Pushed only, so the build report prints it once.
            const warn = new WebpackError(
              messages.hostPermissionPatternsIgnored(hits)
            ) as Error & {file?: string; name?: string}
            warn.name = 'ManifestHostPermissionWarning'
            warn.file = 'manifest.json'
            compilation.warnings.push(warn)
          }
        )
      }
    )
  }
}
