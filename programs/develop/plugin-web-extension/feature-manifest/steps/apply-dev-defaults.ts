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
import type {DevOptions, PluginInterface} from '../../../types'
import {
  getManifestContent,
  setCurrentManifestContent
} from '../manifest-lib/manifest'
import patchBackground from './apply-dev-defaults-lib/patch-background'
import {patchV2CSP, patchV3CSP} from './apply-dev-defaults-lib/patch-csp'
import patchExternallyConnectable from './apply-dev-defaults-lib/patch-externally-connectable'
import {
  patchWebResourcesV2,
  patchWebResourcesV3
} from './apply-dev-defaults-lib/patch-web-resources'

// Dev instrumentation injects these into the dist manifest; user code relying on
// an undeclared one ships broken. `tabs` is excluded: warnings would be noise.
const INJECTED_PERMISSION_APIS = ['storage', 'scripting', 'management'] as const

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
export class ApplyDevDefaults {
  private readonly manifestPath?: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return
    if (compiler.options.mode !== 'development') return

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

            const canonicalManifest = getManifestContent(
              compilation,
              this.manifestPath
            )

            // Match patterns of every declared content script. Used below to
            // grant host access for the dev open-tab re-injection.
            const contentScriptMatches: string[] = Array.isArray(
              canonicalManifest.content_scripts
            )
              ? (
                  canonicalManifest.content_scripts as Array<{
                    matches?: unknown
                  }>
                ).flatMap((cs) =>
                  Array.isArray(cs?.matches) ? cs.matches : []
                )
              : []

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

            const patchedManifest = {
              ...canonicalManifest,
              content_security_policy:
                canonicalManifest.manifest_version === 3
                  ? patchV3CSP(canonicalManifest)
                  : patchV2CSP(canonicalManifest),

              // Dev-only permissions for the control bridge + reload loop. MV2 also
              // needs content-script host patterns in `permissions` (no host_permissions).
              ...(canonicalManifest.manifest_version === 3
                ? {
                    permissions: [
                      ...new Set([
                        'scripting',
                        'tabs',
                        'management',
                        'storage',
                        ...(canonicalManifest.permissions || [])
                      ])
                    ]
                  }
                : {
                    permissions: [
                      ...new Set([
                        'tabs',
                        'storage',
                        ...contentScriptMatches,
                        ...(canonicalManifest.permissions || [])
                      ])
                    ]
                  }),
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
            try {
              const declared = new Set<string>([
                ...((canonicalManifest.permissions as string[]) || []),
                ...((canonicalManifest.optional_permissions as string[]) || [])
              ])
              const injectedForEra =
                canonicalManifest.manifest_version === 3
                  ? INJECTED_PERMISSION_APIS
                  : (['storage'] as const)
              const uses = findInjectedOnlyPermissionUses(
                compilation,
                declared,
                injectedForEra
              )
              for (const [api, file] of uses) {
                const WebpackErrorCtor = compiler.rspack?.WebpackError
                const text =
                  `manifest.json does not declare the "${api}" permission, but ` +
                  `${path.relative(path.dirname(this.manifestPath), file)} uses chrome.${api}. ` +
                  `It works in development only because the dev instrumentation ` +
                  `injects "${api}" — the production build will fail at runtime. ` +
                  `Add "${api}" to permissions in manifest.json.`
                const warning = WebpackErrorCtor
                  ? new WebpackErrorCtor(text)
                  : (new Error(text) as Error)
                warning.name = 'DevInjectedPermissionWarning'
                compilation.warnings.push(
                  warning as (typeof compilation.warnings)[number]
                )
              }
            } catch {
              // diagnostics only; never fail the compile over the scan
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
