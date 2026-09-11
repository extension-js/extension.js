// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import * as fs from 'fs'
import * as path from 'path'
import {isStaticThemeSource} from '../../../lib/manifest-utils'
import type {DevOptions, PluginInterface} from '../../../types'
import {
  getManifestContent,
  setCurrentManifestContent
} from '../manifest-lib/manifest'
import {
  declaredHostPatterns,
  devInjectedHostPatterns,
  findInjectedOnlyHostUses,
  optionalHostPatterns
} from './apply-dev-defaults-lib/dev-injected-hosts'
import {
  devInjectedPermissions,
  partiallyGatedNote,
  partiallyGatedWarning
} from './apply-dev-defaults-lib/dev-injected-permissions'
import patchBackground from './apply-dev-defaults-lib/patch-background'
import {patchV2CSP, patchV3CSP} from './apply-dev-defaults-lib/patch-csp'
import patchExternallyConnectable from './apply-dev-defaults-lib/patch-externally-connectable'
import {
  patchWebResourcesV2,
  patchWebResourcesV3
} from './apply-dev-defaults-lib/patch-web-resources'

// Scan the module graph's own source files for chrome/browser API usage whose
// permission is dev-injected but undeclared. Emitted bundles would false-positive.
export function findInjectedOnlyPermissionUses(
  compilation: Pick<Compilation, 'modules'>,
  declared: Set<string>,
  injected: readonly string[]
): Map<string, string> {
  const firstOffenderByApi = new Map<string, string>()
  const candidates = injected.filter((api) => !declared.has(api))
  if (!candidates.length) return firstOffenderByApi

  for (const module of compilation.modules) {
    const resource = (module as {resource?: string}).resource
    if (!resource || resource.includes('node_modules')) continue
    if (!/\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(resource)) continue
    let source: string
    try {
      const stat = fs.statSync(resource)
      if (stat.size > 1024 * 1024) continue
      source = fs.readFileSync(resource, 'utf-8')
    } catch {
      continue
    }
    for (const api of candidates) {
      if (firstOffenderByApi.has(api)) continue
      const useRe = new RegExp(`\\b(?:chrome|browser)\\s*\\.\\s*${api}\\b`)
      if (useRe.test(source)) firstOffenderByApi.set(api, resource)
    }
    if (firstOffenderByApi.size === candidates.length) break
  }
  return firstOffenderByApi
}

/**
 * Applies dev-only manifest patches (CSP, permissions, background, WAR for reload).
 * Runs only in development mode, after WAR patching (REPORT+100).
 */
// A host permission for the request's own origin is the narrow grant; the
// content-script pattern is often <all_urls> and would widen the store prompt.
function requestOriginPattern(url: string, fallback: string): string {
  try {
    return `${new URL(url).origin}/*`
  } catch {
    return fallback
  }
}

export class ApplyDevDefaults {
  private readonly manifestPath?: string
  private readonly browser: DevOptions['browser']

  private readonly devSession?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return
    if (compiler.options.mode !== 'development') return
    // Only a dev session takes the dev manifest: a build in development
    // mode is shippable and keeps the author's CSP and permissions.
    if (this.devSession === false) return

    compiler.hooks.thisCompilation.tap(
      'manifest:apply-dev-defaults',
      (compilation) => {
        if (!compilation?.hooks?.processAssets) return
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:apply-dev-defaults',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            if (compilation.errors.length > 0) return
            if (!this.manifestPath) {
              try {
                const WebpackErrorCtor = compiler.rspack?.WebpackError
                compilation.errors.push(
                  WebpackErrorCtor
                    ? new WebpackErrorCtor(
                        'manifest: No manifest.json path. Unable to apply dev defaults.'
                      )
                    : new Error(
                        'manifest: No manifest.json path. Unable to apply dev defaults.'
                      )
                )
              } catch {
                // Ignore
              }
              return
            }

            // A static theme is validated against the theme schema, which
            // forbids every key below: injecting them is 4 AMO hard errors.
            if (isStaticThemeSource(this.manifestPath, this.browser)) return

            const canonicalManifest = getManifestContent(
              compilation,
              this.manifestPath
            )

            // Match patterns of every declared content script. One list drives
            // the patch below and all three host warnings, so the dev manifest
            // can never grant a host the warnings miss.
            const contentScriptMatches: readonly string[] =
              devInjectedHostPatterns(canonicalManifest)

            // MV3 with content scripts: grant host access so the SW can inject the
            // fresh script into already-open tabs on save. Never ships to production.
            const hostPermissionsPatch =
              canonicalManifest.manifest_version === 3 &&
              contentScriptMatches.length > 0
                ? {
                    host_permissions: [
                      ...new Set([
                        ...((canonicalManifest.host_permissions as string[]) ||
                          []),
                        ...contentScriptMatches
                      ])
                    ]
                  }
                : {}

            // Dev injects what the bridge needs, but a permission or host
            // the author kept optional turns required the moment dev lists
            // it, so every promotion is named rather than left silent.
            const pushDevWarning = (name: string, text: string) => {
              const WebpackErrorCtor = compiler.rspack?.WebpackError
              const warning = WebpackErrorCtor
                ? new WebpackErrorCtor(text)
                : (new Error(text) as Error)
              warning.name = name
              if (!compilation.warnings) compilation.warnings = []
              compilation.warnings.push(
                warning as (typeof compilation.warnings)[number]
              )
            }
            const optionalPermissions = new Set<string>(
              (canonicalManifest.optional_permissions as string[]) || []
            )
            const optionalHosts = new Set<string>([
              ...((canonicalManifest.optional_host_permissions as string[]) ||
                []),
              ...(canonicalManifest.manifest_version === 3
                ? []
                : [...optionalPermissions])
            ])
            // One list drives the patch below and both warnings, so the dev
            // manifest can never grant a permission the warnings miss.
            const injectedPermissions = devInjectedPermissions(
              canonicalManifest.manifest_version
            )
            for (const permission of injectedPermissions) {
              if (
                optionalPermissions.has(permission) &&
                !((canonicalManifest.permissions as string[]) || []).includes(
                  permission
                )
              ) {
                pushDevWarning(
                  'DevPromotedOptionalPermissionWarning',
                  `manifest.json lists "${permission}" under optional_permissions, but the dev build ` +
                    `needs it and lists it under permissions too. Listed in both means required, ` +
                    `so in development it is granted at install and your runtime request flow ` +
                    `never runs. The production build keeps it optional.`
                )
              }
            }
            for (const match of contentScriptMatches) {
              if (optionalHosts.has(match)) {
                pushDevWarning(
                  'DevPromotedOptionalHostWarning',
                  `manifest.json keeps "${match}" optional, but a content script matches it and the ` +
                    `dev build grants that host at install so it can re-inject the script on save. ` +
                    `In development the host is required. The production build keeps it optional.`
                )
              }
            }

            const patchedManifest = {
              ...canonicalManifest,
              content_security_policy:
                canonicalManifest.manifest_version === 3
                  ? patchV3CSP(canonicalManifest)
                  : patchV2CSP(canonicalManifest),

              // Dev-only permissions for the control bridge + reload loop. MV2 also
              // needs content-script host patterns in `permissions` (no host_permissions).
              permissions: [
                ...new Set([
                  ...injectedPermissions,
                  ...(canonicalManifest.manifest_version === 3
                    ? []
                    : contentScriptMatches),
                  ...(canonicalManifest.permissions || [])
                ])
              ],
              ...hostPermissionsPatch,

              ...patchBackground(canonicalManifest, this.browser),
              ...patchExternallyConnectable(canonicalManifest),
              web_accessible_resources:
                canonicalManifest.manifest_version === 3
                  ? patchWebResourcesV3(canonicalManifest)
                  : patchWebResourcesV2(canonicalManifest)
            }

            // Warn when the user's own source leans on a permission only the dev
            // instrumentation injected: it works in dev and fails in production.
            // An optional permission counts as undeclared here: the shipped
            // build has it only after a runtime request the dev build skips.
            try {
              const declared = new Set<string>(
                (canonicalManifest.permissions as string[]) || []
              )
              const uses = findInjectedOnlyPermissionUses(
                compilation,
                declared,
                injectedPermissions
              )
              for (const [api, file] of uses) {
                const relative = path.relative(
                  path.dirname(this.manifestPath),
                  file
                )
                const text = optionalPermissions.has(api)
                  ? `manifest.json only lists the "${api}" permission under optional_permissions, but ` +
                    `${relative} uses chrome.${api}. It works in development only because the dev ` +
                    `instrumentation injects "${api}" as required: the production build has it only ` +
                    `after a runtime chrome.permissions.request, so guard the use or move "${api}" to permissions.`
                  : partiallyGatedWarning(api, relative) ||
                    `manifest.json does not declare the "${api}" permission, but ` +
                      `${relative} uses chrome.${api}. ` +
                      `It works in development only because the dev instrumentation ` +
                      `injects "${api}": the production build will fail at runtime. ` +
                      `Add "${api}" to permissions in manifest.json.`
                pushDevWarning(
                  'DevInjectedPermissionWarning',
                  optionalPermissions.has(api)
                    ? text + partiallyGatedNote(api)
                    : text
                )
              }
            } catch {
              // Diagnostics only, never fail the compile over the scan
            }

            // Warn when source outside a content script requests a host that
            // only the content-script match unioned in. Dev answers it and the
            // packaged build has no host permission for it.
            try {
              const injectedOnlyHosts = findInjectedOnlyHostUses(
                compilation.modules as Iterable<{
                  resource?: string
                  layer?: string | null
                }>,
                contentScriptMatches,
                declaredHostPatterns(canonicalManifest),
                optionalHostPatterns(canonicalManifest)
              )
              const hostKey =
                canonicalManifest.manifest_version === 3
                  ? 'host_permissions'
                  : 'permissions'
              for (const use of injectedOnlyHosts) {
                const relative = path.relative(
                  path.dirname(this.manifestPath),
                  use.file
                )
                const text = use.optional
                  ? `manifest.json only lists "${use.pattern}" under optional host permissions, but ` +
                    `${relative} requests ${use.url}. It works in development only because a content ` +
                    `script matches "${use.pattern}" and the dev build grants that host as required ` +
                    `so it can re-inject the script on save. The production build has the host only ` +
                    `after a runtime chrome.permissions.request, so guard the request or add ` +
                    `"${use.pattern}" to ${hostKey} in manifest.json.`
                  : `manifest.json does not grant host access to ${use.url}, but ${relative} ` +
                    `requests it. The dev build grants that host because a content script ` +
                    `matches "${use.pattern}" and it re-injects the script on save. The ` +
                    `production build has no host permission for it, so the request is ` +
                    `subject to the server's CORS policy and is blocked when the server ` +
                    `does not allow it. If it needs the permission, add ` +
                    `"${requestOriginPattern(use.url, use.pattern)}" to ${hostKey} in ` +
                    `manifest.json rather than the content-script pattern.`
                pushDevWarning('DevInjectedHostWarning', text)
              }
            } catch {
              // Diagnostics only, never fail the compile over the scan
            }

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)
            setCurrentManifestContent(compilation, source)

            if (compilation.getAsset('manifest.json')) {
              compilation.updateAsset('manifest.json', rawSource)
            }
          }
        )
      }
    )
  }
}
