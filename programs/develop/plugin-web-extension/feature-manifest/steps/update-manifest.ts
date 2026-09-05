// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {
  getCanonicalContentScriptJsAssetName,
  parseCanonicalContentScriptAsset
} from '../../feature-scripts/contracts'
import {missingGeckoDataCollectionPermissions} from '../manifest-lib/gecko-data-collection'
import {
  buildCanonicalManifest,
  getManifestContent,
  setCurrentManifestContent
} from '../manifest-lib/manifest'
import {sanitizeFatalManifestShapes} from '../manifest-lib/sanitize-fatal-shapes'
import {getManifestOverrides} from '../manifest-overrides'

// A single `content_scripts` entry as carried by the canonical `Manifest`
// type (MV2/MV3 intersection). Used to read `css`/`js` without `as any`.
type ContentScriptEntry = NonNullable<Manifest['content_scripts']>[number]

import {humanLine} from '../../../dev-server/lifecycle-stream'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {isDebug} from '../../../lib/messaging'
import {reportToCompilation} from '../../shared/compilation-issues'
import {pageActionDropReason} from '../../shared/html-surfaces'
import * as messages from '../messages'
import {patchChromiumBackground} from './patch-chromium-background'
import {patchChromiumThemeColors} from './patch-chromium-theme-colors'
import {patchDevContentScriptManifestPaths} from './patch-dev-content-script-manifest-paths'
import {patchGeckoBackground} from './patch-gecko-background'

export class UpdateManifest {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  // Dev recompiles re-run the same repairs on every save. One human line per
  // distinct fix for the life of this plugin (one `extension dev` process) is
  // enough; a restarted session gets a fresh instance and prints again.
  // Production builds never consult this set so build output stays complete.
  private reportedFatalFixes = new Set<string>()

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private applyDevOverrides(manifest: Manifest) {
    if (!manifest.content_scripts) return []

    return manifest.content_scripts.map((contentObj, index) => {
      const css = contentObj.css ?? []
      const js = contentObj.js ?? []
      if (css.length && !js.length) {
        // The group's entry always emits a JS chunk named after the canonical group
        // index, which can differ from array position; read it back from the css path.
        const canonicalIndex =
          parseCanonicalContentScriptAsset(css[0])?.index ?? index
        contentObj.js = [getCanonicalContentScriptJsAssetName(canonicalIndex)]
      }

      return contentObj
    })
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'manifest:update-manifest',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:update-manifest',
            // Run after env substitution but before REPORT-stage patchers, which read
            // manifest.json from assets and must see the canonical rewritten paths.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 1
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifest = getManifestContent(compilation, this.manifestPath)
            const dropReason = pageActionDropReason(
              filterKeysForThisBrowser(manifest, this.browser),
              this.browser
            )
            if (dropReason) {
              reportToCompilation(
                compilation,
                compiler,
                dropReason === 'conflicts'
                  ? messages.pageActionDroppedForBrowserAction(
                      String(this.browser)
                    )
                  : messages.pageActionNotSupportedByBrowser(
                      String(this.browser)
                    ),
                'warning',
                'manifest.json'
              )
            }
            // The overrides need the project root to find a root public/
            // folder when the manifest lives in src/.
            const projectPath =
              compiler.options.context || path.dirname(this.manifestPath)
            let patchedManifest = buildCanonicalManifest(
              this.manifestPath,
              manifest,
              this.browser,
              projectPath
            ) as Manifest

            // Firefox can't load background.service_worker, translate it to a
            // background.scripts event page pointing at the same emitted bundle.
            patchedManifest = patchGeckoBackground(
              patchedManifest,
              this.browser
            )

            // And the mirror: Chromium can't load MV3 background.scripts,
            // translate it to a classic service worker on the same bundle.
            patchedManifest = patchChromiumBackground(
              patchedManifest,
              this.browser
            )

            // Firefox reads theme.colors as CSS strings, Chrome as integer
            // arrays. Convert hex for chromium so one manifest serves both.
            patchedManifest = patchChromiumThemeColors(
              patchedManifest,
              this.browser
            )

            const overrides = getManifestOverrides(
              this.manifestPath,
              manifest,
              projectPath
            )

            // Dev-only: content_scripts with only CSS get a JS file so styles can be
            // dynamically imported (HMR). Must run before patchDevContentScriptManifestPaths.
            if (compiler.options.mode === 'development') {
              if (patchedManifest.content_scripts) {
                patchedManifest.content_scripts =
                  this.applyDevOverrides(patchedManifest)
              }

              patchedManifest = patchDevContentScriptManifestPaths(
                compilation,
                patchedManifest
              )
            }

            if (isDebug()) {
              try {
                const overrideObj = JSON.parse(overrides || '{}')
                const overrideKeys = Object.keys(overrideObj || {}).length
                let devCssStubsAdded = 0

                if (
                  compiler.options.mode === 'development' &&
                  Array.isArray(patchedManifest.content_scripts)
                ) {
                  for (const cs of patchedManifest.content_scripts as ContentScriptEntry[]) {
                    try {
                      const hasCss = Array.isArray(cs.css) && cs.css.length > 0
                      const hasJs = Array.isArray(cs.js) && cs.js.length > 0
                      if (hasCss && hasJs && cs.js?.length === 1) {
                        devCssStubsAdded++
                      }
                    } catch {
                      // Ignore
                    }
                  }
                }
                console.log(
                  messages.manifestOverridesSummary(
                    overrideKeys,
                    devCssStubsAdded
                  )
                )
              } catch {
                // Ignore
              }
            }

            // Repair shapes Chrome refuses to load over (numeric version, empty or 0-byte
            // icons): --load-extension surfaces refusal only as a native modal. Warn too.
            const sanitized = sanitizeFatalManifestShapes(
              patchedManifest,
              path.dirname(this.manifestPath)
            )
            patchedManifest = sanitized.manifest
            const isDev = compiler.options.mode === 'development'
            for (const fix of sanitized.fixes) {
              // Always repair; only the notice is session-deduped in development.
              if (isDev) {
                const signature = `${fix.field}\0${fix.detail}`
                if (this.reportedFatalFixes.has(signature)) continue
                this.reportedFatalFixes.add(signature)
              }

              const message = messages.fatalManifestShapeFixed(
                fix.field,
                fix.detail
              )
              // The human line prints here, when the repair happens; the pushed
              // warning is the stats/json record and the stats render skips it.
              humanLine(message)
              const warn = new WebpackError(message) as Error & {
                file?: string
                name?: string
              }
              warn.name = 'ManifestFatalShapeWarning'
              warn.file = 'manifest.json'
              compilation.warnings.push(warn)
            }

            // Store-readiness hint for AMO submissions: production artifacts
            // only, so dev recompiles don't repeat it on every save.
            if (
              compiler.options.mode === 'production' &&
              isGeckoBasedBrowser(String(this.browser)) &&
              missingGeckoDataCollectionPermissions(patchedManifest)
            ) {
              const warn = new WebpackError(
                messages.missingGeckoDataCollectionPermissions()
              ) as Error & {file?: string; name?: string}
              warn.name = 'AmoDataCollectionWarning'
              warn.file = 'manifest.json'
              compilation.warnings.push(warn)
            }

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)
            setCurrentManifestContent(compilation, source)

            if (compilation.getAsset('manifest.json')) {
              compilation.updateAsset('manifest.json', rawSource)
            } else {
              compilation.emitAsset('manifest.json', rawSource)
            }
          }
        )
      }
    )
  }
}
