// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {
  getCanonicalContentScriptJsAssetName,
  parseCanonicalContentScriptAsset
} from '../../feature-scripts/contracts'
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

import * as messages from '../messages'
import {patchChromiumBackground} from './patch-chromium-background'
import {patchDevContentScriptManifestPaths} from './patch-dev-content-script-manifest-paths'
import {patchGeckoBackground} from './patch-gecko-background'

export class UpdateManifest {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

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
        // The group's entry always emits a JS chunk (it carries the CSS HMR
        // runtime), named after the canonical group index, which can differ
        // from the array position once MAIN-world bridges are inserted, so
        // read the index back from the rewritten css path.
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
            // Run after env substitution but before REPORT-stage manifest
            // patchers. Later patchers read manifest.json from assets, so they
            // must see the canonical rewritten paths, and the write-to-disk
            // flow must persist those canonical paths before Chromium loads.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 1
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifest = getManifestContent(compilation, this.manifestPath)

            let patchedManifest = buildCanonicalManifest(
              this.manifestPath,
              manifest,
              this.browser
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

            const overrides = getManifestOverrides(this.manifestPath, manifest)

            // During development, if user has only CSS files in content_scripts,
            // we add a JS file to the content_scripts bundle so that
            // these files can be dynamically imported, thus allowing HMR.
            // Must run before patchDevContentScriptManifestPaths so the
            // canonical js name it injects resolves to the hashed emitted
            // asset like every other content-script reference.
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

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
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
                      // Ignore guard errors
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
                // Ignore guard errors
              }
            }

            // Repair shapes Chrome refuses to load the extension over
            // (numeric version, empty default_icon, icon paths that resolve
            // to 0-byte files). --load-extension surfaces the refusal only
            // as a native modal, wedging the dev session before CDP binds,
            // so repair, and warn so the author fixes the source manifest.
            const sanitized = sanitizeFatalManifestShapes(
              patchedManifest,
              path.dirname(this.manifestPath)
            )
            patchedManifest = sanitized.manifest
            for (const fix of sanitized.fixes) {
              const warn = new WebpackError(
                messages.fatalManifestShapeFixed(fix.field, fix.detail)
              ) as Error & {file?: string; name?: string}
              warn.name = 'ManifestFatalShapeWarning'
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
