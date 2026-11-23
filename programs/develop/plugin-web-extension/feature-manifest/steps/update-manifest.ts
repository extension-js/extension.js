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
import {readGeckoManifestId} from '../../../lib/extension-id'
import {
  filterKeysForThisBrowser,
  findDroppedVendorKeys,
  findPrefixedManifestVersionKeys,
  isValidManifestVersion
} from '../../../lib/manifest-utils'
import {debugLine, humanLine, isDebug} from '../../../lib/messaging'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {isHollowContentScript} from '../../feature-scripts/contracts'
import {reportToCompilation} from '../../shared/compilation-issues'
import {
  pageActionDropReason,
  shouldFoldActionIntoBrowserAction,
  shouldFoldBrowserActionIntoAction,
  sidebarFoldTarget
} from '../../shared/html-surfaces'
import {applyKeptPagePaths, keptPagePaths} from '../../shared/kept-page-paths'
import {manifestExtensionsFor} from '../../shared/manifest-extensions'
import {missingGeckoDataCollectionPermissions} from '../manifest-lib/gecko-data-collection'
import {
  buildCanonicalManifestWithOverrides,
  getManifestContent
} from '../manifest-lib/manifest'
import {
  findMistypedManifestFields,
  sanitizeFatalManifestShapes
} from '../manifest-lib/sanitize-fatal-shapes'
import {hasMv3StringPolicy} from '../manifest-overrides/common/content_security_policy'
import {hasMv2SandboxPolicy} from '../manifest-overrides/mv2/content_security_policy'
import * as messages from '../messages'
import {
  hasUnsupportedMv3BackgroundPage,
  patchChromiumBackground
} from './patch-chromium-background'
import {
  patchChromiumThemeColors,
  translatedThemeColors
} from './patch-chromium-theme-colors'
import {
  hasEmptyGeckoBackgroundScripts,
  patchGeckoBackground,
  translatesGeckoServiceWorker
} from './patch-gecko-background'
import {patchWebkitBackground} from './patch-webkit-background'
import {reportGeckoUnsupportedApis} from './warn-gecko-unsupported-apis'

export class UpdateManifest {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  // Dev recompiles re-run the same repairs on every save. One human line per
  // distinct fix for the life of this plugin (one `extension dev` process) is
  // enough; a restarted session gets a fresh instance and prints again.
  // Production builds never consult this set so build output stays complete.
  private reportedFatalFixes = new Set<string>()
  // A sidebar key folded for the target is said once per session, as a note:
  // the build fixed it, so a warning would claim a panel that does open.
  private reportedSidebarFolds = new Set<string>()
  // The service worker moved into background.scripts is a note on the same terms.
  private reportedWorkerMoves = new Set<string>()
  // So are the theme colors written as arrays for a Chromium build.
  private reportedThemeColors = new Set<string>()
  // Same contract for the Safari unsupported-API warning, which fires in
  // development too: one line per distinct call, not one on every save.
  private reportedUnsupportedApis = new Set<string>()
  // A page kept at its authored path is said once per session too.
  private reportedKeptPages = new Set<string>()
  // The missing add-on ID warning is said once per build and once per session.
  private reportedGeckoAddonId = false

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  // Store-readiness hint for AMO submissions: production artifacts
  // only, so dev recompiles don't repeat it on every save.
  private warnMissingDataCollection(
    compiler: Compiler,
    compilation: Compilation,
    manifest: Manifest
  ) {
    if (
      compiler.options.mode !== 'production' ||
      !isGeckoBasedBrowser(String(this.browser)) ||
      !missingGeckoDataCollectionPermissions(manifest)
    ) {
      return
    }

    const warn = new WebpackError(
      messages.missingGeckoDataCollectionPermissions()
    ) as Error & {file?: string; name?: string}
    warn.name = 'AmoDataCollectionWarning'
    warn.file = 'manifest.json'
    compilation.warnings.push(warn)
  }

  // A build that failed elsewhere still owes the store hint, read from the
  // manifest as written. One that cannot be read has its own error.
  private warnMissingDataCollectionOfAuthored(
    compiler: Compiler,
    compilation: Compilation
  ) {
    let authored: Manifest

    try {
      authored = filterKeysForThisBrowser(
        getManifestContent(compilation, this.manifestPath),
        this.browser
      ) as Manifest
    } catch {
      return
    }

    if (!authored || typeof authored !== 'object') return

    this.warnMissingDataCollection(compiler, compilation, authored)
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
            if (compilation.errors.length > 0) {
              this.warnMissingDataCollectionOfAuthored(compiler, compilation)

              return
            }

            const manifest = getManifestContent(compilation, this.manifestPath)
            const forBrowser = filterKeysForThisBrowser(
              manifest,
              this.browser
            ) as Manifest
            const mistyped = findMistypedManifestFields(forBrowser)

            if (mistyped.length > 0) {
              for (const entry of mistyped) {
                reportToCompilation(
                  compilation,
                  compiler,
                  messages.manifestFieldMistyped(
                    entry.field,
                    entry.expected,
                    entry.received
                  ),
                  'error',
                  'manifest.json'
                )
              }

              this.warnMissingDataCollection(compiler, compilation, forBrowser)

              return
            }

            const dropReason = pageActionDropReason(forBrowser, this.browser)

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

            if (hasMv2SandboxPolicy(forBrowser)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.mv2SandboxPolicyDropped(String(this.browser)),
                'warning',
                'manifest.json'
              )
            }

            if (hasMv3StringPolicy(forBrowser)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.mv3StringPolicyRewritten(String(this.browser)),
                'warning',
                'manifest.json'
              )
            }

            if (shouldFoldBrowserActionIntoAction(forBrowser)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.mv3BrowserActionFoldedIntoAction(String(this.browser)),
                'warning',
                'manifest.json'
              )
            }

            if (shouldFoldActionIntoBrowserAction(forBrowser)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.mv2ActionFoldedIntoBrowserAction(String(this.browser)),
                'warning',
                'manifest.json'
              )
            }

            const sidebarFold = sidebarFoldTarget(forBrowser, this.browser)

            if (sidebarFold) {
              const signature = `${String(this.browser)}\0${sidebarFold}`

              if (!this.reportedSidebarFolds.has(signature)) {
                this.reportedSidebarFolds.add(signature)
                humanLine(
                  messages.sidebarKeyTranslatedForBrowser(
                    String(this.browser),
                    sidebarFold === 'side_panel'
                      ? 'sidebar_action'
                      : 'side_panel',
                    sidebarFold
                  )
                )
              }
            }

            if (
              translatesGeckoServiceWorker(forBrowser, this.browser) &&
              !this.reportedWorkerMoves.has(String(this.browser))
            ) {
              this.reportedWorkerMoves.add(String(this.browser))
              humanLine(
                messages.geckoServiceWorkerTranslated(String(this.browser))
              )
            }

            const themeColors = translatedThemeColors(forBrowser, this.browser)
            const themeSignature = [
              String(this.browser),
              ...themeColors.map(({key}) => key)
            ].join('\0')

            if (
              themeColors.length > 0 &&
              !this.reportedThemeColors.has(themeSignature)
            ) {
              this.reportedThemeColors.add(themeSignature)
              humanLine(
                messages.themeColorsTranslated(
                  String(this.browser),
                  themeColors
                )
              )
            }

            if (hasUnsupportedMv3BackgroundPage(forBrowser, this.browser)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.mv3BackgroundPageUnsupported(String(this.browser)),
                'warning',
                'manifest.json'
              )
            }

            if (hasEmptyGeckoBackgroundScripts(forBrowser, this.browser)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.geckoEmptyBackgroundScriptsDropped(
                  String(this.browser),
                  Boolean(
                    forBrowser.background?.service_worker ||
                      forBrowser.background?.page
                  )
                ),
                'warning',
                'manifest.json'
              )
            }

            // A key another vendor used to reach through the family rule
            // is silent to drop, so the build says it moved.
            for (const dropped of findDroppedVendorKeys(
              manifest,
              this.browser
            )) {
              if (!dropped.appliedBefore) continue

              reportToCompilation(
                compilation,
                compiler,
                messages.vendorPrefixedKeyDropped(
                  dropped.path,
                  dropped.familyPath,
                  dropped.vendor,
                  String(this.browser)
                ),
                'warning',
                'manifest.json'
              )
            }

            const rawContentScripts = Array.isArray(manifest.content_scripts)
              ? (manifest.content_scripts as unknown[])
              : []

            for (const [index, entry] of (
              forBrowser.content_scripts ?? []
            ).entries()) {
              if (!isHollowContentScript(entry)) continue

              const raw = rawContentScripts[index]
              const prefixedKeys =
                raw && typeof raw === 'object' && !Array.isArray(raw)
                  ? Object.keys(raw).filter((key) => key.includes(':'))
                  : []

              reportToCompilation(
                compilation,
                compiler,
                messages.contentScriptEntryDroppedForBrowser(
                  index,
                  String(this.browser),
                  prefixedKeys
                ),
                'warning',
                'manifest.json'
              )
            }

            // A manifest_version scoped to another vendor leaves this build
            // with none, and no browser loads that, so refuse it here.
            if (!isValidManifestVersion(forBrowser.manifest_version)) {
              reportToCompilation(
                compilation,
                compiler,
                messages.manifestVersionLostForBrowser(
                  String(this.browser),
                  findPrefixedManifestVersionKeys(manifest),
                  forBrowser.manifest_version
                ),
                'error',
                'manifest.json'
              )
            }

            // The overrides need the project root to find a root public/
            // folder when the manifest lives in src/.
            const projectPath =
              compiler.options.context || path.dirname(this.manifestPath)
            const canonical = buildCanonicalManifestWithOverrides(
              this.manifestPath,
              manifest,
              this.browser,
              projectPath
            )
            const overrides = canonical.overrides
            let patchedManifest = canonical.manifest

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

            // Safari counts as chromium for manifest keys, so it passes through
            // the step above first. It never starts a service worker, so the
            // last word on a Safari build is a non-persistent background page.
            patchedManifest = patchWebkitBackground(
              patchedManifest,
              this.browser
            )

            // Firefox reads theme.colors as CSS strings, Chromium as number
            // arrays. Port the exact ones so one manifest serves both.
            patchedManifest = patchChromiumThemeColors(
              patchedManifest,
              this.browser
            )

            // A page whose authored path a script holds opens at that path,
            // so sender.url and location read as they do from the source.
            const keptPages = applyKeptPagePaths(
              patchedManifest,
              keptPagePaths(compilation)
            )
            patchedManifest = keptPages.manifest

            for (const authored of new Set(
              keptPages.applied.map((page) => page.authored)
            )) {
              if (this.reportedKeptPages.has(authored)) continue

              this.reportedKeptPages.add(authored)

              const pages = keptPages.applied.filter(
                (page) => page.authored === authored
              )

              humanLine(
                messages.pageKeptAtAuthoredPath(
                  pages.map((page) => page.field),
                  authored,
                  [...new Set(pages.map((page) => page.output))],
                  pages[0].mentionedIn
                )
              )
            }

            // A plugin applied after this one may change the resolved manifest.
            for (const extension of manifestExtensionsFor(compiler)) {
              patchedManifest = extension.manifestResolved(
                compilation,
                patchedManifest
              )
            }

            if (isDebug()) {
              try {
                const overrideObj = JSON.parse(overrides || '{}')
                const overrideKeys = Object.keys(overrideObj || {}).length

                debugLine(messages.manifestOverridesSummary(overrideKeys))
              } catch {
                // Ignore
              }
            }

            // Repair shapes Chrome refuses to load over (numeric version, empty or 0-byte
            // icons): --load-extension surfaces refusal only as a native modal. Warn too.
            const sanitized = sanitizeFatalManifestShapes(
              patchedManifest,
              path.dirname(this.manifestPath),
              String(this.browser)
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
                fix.detail,
                fix.refusedBy
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

            this.warnMissingDataCollection(
              compiler,
              compilation,
              patchedManifest
            )

            // Without an add-on ID Firefox mints a new one per temporary
            // install, so storage is lost on relaunch. Dev says it too.
            if (
              !this.reportedGeckoAddonId &&
              isGeckoBasedBrowser(String(this.browser))
            ) {
              const geckoId = readGeckoManifestId(
                patchedManifest as Record<string, unknown>
              )

              if (!geckoId.valid) {
                this.reportedGeckoAddonId = true
                const warn = new WebpackError(
                  messages.missingGeckoAddonId(geckoId.declared)
                ) as Error & {file?: string; name?: string}
                warn.name = 'GeckoAddonIdWarning'
                warn.file = 'manifest.json'
                compilation.warnings.push(warn)
              }
            }

            // Two warnings share one scan. On Gecko it is a store-readiness
            // hint: a Chromium-only API that survived into the build is what
            // addons-linter reports as UNSUPPORTED_API. On Safari it is a
            // fatal-call warning, so it runs in development too, where the
            // throw kills the background and nothing else can report it.
            reportGeckoUnsupportedApis(
              compilation,
              compiler,
              this.browser,
              patchedManifest,
              projectPath,
              this.reportedUnsupportedApis
            )

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)

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
