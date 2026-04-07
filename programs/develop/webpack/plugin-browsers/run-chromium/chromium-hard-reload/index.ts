// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {Compilation, Compiler} from '@rspack/core'
import type {ChromiumContext} from '../chromium-context'
import * as messages from '../../browsers-lib/messages'
import {emitActionEvent} from '../../browsers-lib/source-output'
import {waitForStableManifest} from '../manifest-readiness'
import type {DevOptions} from '../../../webpack-types'
import {
  collectContentScriptDependencyPaths,
  getChangedContentScriptEntryNames,
  isContentScriptEntryName,
  isCanonicalContentScriptAsset,
  normalizeModuleResourcePath,
  readContentScriptRules,
  selectContentScriptRules
} from '../../browsers-lib/content-script-targets'
import {
  getCanonicalContentScriptEntryName,
  parseCanonicalContentScriptAsset
} from '../../../plugin-web-extension/feature-scripts/contracts'

/**
 * ChromiumHardReloadPlugin
 *
 * Intended responsibilities:
 * - watchRun: detect manifest/_locales/SW changes and mark pending reason
 * - done: perform CDP hard reload when build succeeds
 */
export class ChromiumHardReloadPlugin {
  private logger?: ReturnType<Compiler['getInfrastructureLogger']>
  private warnedDevMode?: boolean
  private warnedHardReloadFailure?: boolean
  private hasCompletedSuccessfulBuild = false
  private firstSuccessfulBuildAtMs: number | null = null
  private static readonly INITIAL_RELOAD_COOLDOWN_MS = 5000
  private contentReloadGeneration = 0
  private contentReloadQuietPeriodMs = 1200
  private contentReloadFollowupMs = 1200
  private lastWatchIncludedContentChanges = false
  private awaitingSettledContentBuild = false
  /**
   * Tracks the *author/source* file paths that are part of the service worker entrypoint
   * (including transitive dependencies) from the last successful compilation.
   *
   * Why: `compiler.modifiedFiles` reports changed *source* paths, while the emitted
   * `manifest.json` reports *output* (dist) paths. Comparing those directly will fail.
   */
  private serviceWorkerSourceDependencyPaths: Set<string> = new Set()
  private serviceWorkerSourceSignatures: Map<string, string> = new Map()
  private manifestSourceSignatures: Map<string, string> = new Map()
  private localeSourceSignatures: Map<string, string> = new Map()
  private contentScriptSourceDependencyPathsByEntry: Map<string, Set<string>> =
    new Map()
  private contentScriptSourceSignaturesByEntry: Map<
    string,
    Map<string, string>
  > = new Map()
  private contentScriptOutputSignaturesByEntry: Map<
    string,
    Map<string, string>
  > = new Map()
  private pendingContentReloadEntryNames: string[] = []

  private getWatchedManifestSourcePaths(compiler: Compiler): string[] {
    const compilerContextRoot = String(
      compiler?.options?.context || ''
    ).replace(/\\/g, '/')

    if (!compilerContextRoot) return []

    return [
      `${compilerContextRoot}/manifest.json`,
      `${compilerContextRoot}/src/manifest.json`
    ]
  }

  constructor(
    private readonly options: {
      autoReload?: boolean
      browser?: DevOptions['browser']
      source?: DevOptions['source']
      watchSource?: DevOptions['watchSource']
    },
    private readonly ctx: ChromiumContext
  ) {}

  apply(compiler: Compiler) {
    if (this.options?.autoReload === false) {
      return
    }

    this.logger =
      typeof compiler?.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger('RunChromiumPlugin')
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
          } as ReturnType<Compiler['getInfrastructureLogger']>)

    // watchRun: detect inputs that require hard reload
    if (compiler.hooks?.watchRun?.tapAsync) {
      compiler.hooks.watchRun.tapAsync(
        'run-browsers:watch',
        (compilerWithModifiedFiles, done) => {
          try {
            this.contentReloadGeneration += 1
            const modifiedFiles: ReadonlySet<string> =
              compilerWithModifiedFiles?.modifiedFiles || new Set<string>()
            const normalizedModifiedFilePaths = Array.from(modifiedFiles).map(
              (filePath) => String(filePath).replace(/\\/g, '/')
            )
            const compilerContextRoot = String(
              compiler?.options?.context || ''
            ).replace(/\\/g, '/')
            const filesInCurrentCompilerContext = compilerContextRoot
              ? normalizedModifiedFilePaths.filter(
                  (filePath) =>
                    filePath === compilerContextRoot ||
                    filePath.startsWith(`${compilerContextRoot}/`)
                )
              : normalizedModifiedFilePaths
            const watchedModifiedFilePaths = compilerContextRoot
              ? filesInCurrentCompilerContext
              : normalizedModifiedFilePaths
            const normalizedOutputPath = String(
              compiler?.options?.output?.path || ''
            ).replace(/\\/g, '/')
            const normalizedManifestSourcePaths =
              this.getWatchedManifestSourcePaths(compiler)
            const sourceModifiedFilePaths = watchedModifiedFilePaths.filter(
              (filePath) =>
                !(
                  normalizedOutputPath &&
                  (filePath === normalizedOutputPath ||
                    filePath.startsWith(`${normalizedOutputPath}/`))
                )
            )

            const hitManifest = sourceModifiedFilePaths.some((filePath) => {
              if (normalizedManifestSourcePaths.length > 0) {
                return normalizedManifestSourcePaths.includes(filePath)
              }
              return /(^|\/)manifest\.json$/i.test(filePath)
            })
            const localeChanged = sourceModifiedFilePaths.some((filePath) => {
              if (compilerContextRoot) {
                return filePath.startsWith(
                  `${compilerContextRoot}/src/_locales/`
                )
              }
              return /(^|\/)__?locales\/.+\.json$/i.test(filePath)
            })

            let serviceWorkerChanged = false

            // Preferred: compare against *source* dependency paths captured from the last successful compilation.
            // This correctly catches edits to the service worker entry *and* any imported module.
            if (this.serviceWorkerSourceDependencyPaths.size > 0) {
              serviceWorkerChanged = sourceModifiedFilePaths.some(
                (modifiedFilePath) => {
                  if (
                    this.serviceWorkerSourceDependencyPaths.has(
                      modifiedFilePath
                    )
                  ) {
                    return true
                  }

                  // Best-effort fallback for path normalization differences (symlinks, prefixes).
                  for (const serviceWorkerSourceDependencyPath of this
                    .serviceWorkerSourceDependencyPaths) {
                    if (
                      modifiedFilePath.endsWith(
                        serviceWorkerSourceDependencyPath
                      )
                    ) {
                      return true
                    }
                  }

                  return false
                }
              )
            } else {
              // Fallback: old behavior based on output path from the emitted manifest.
              // This is less reliable because it compares output paths vs source paths.
              const {
                absolutePath: serviceWorkerAbsolutePath,
                relativePath: serviceWorkerRelativePath
              } = this.ctx.getServiceWorkerPaths() || {}

              if (serviceWorkerAbsolutePath) {
                const normalizedServiceWorkerAbsolutePath =
                  serviceWorkerAbsolutePath.replace(/\\/g, '/')

                serviceWorkerChanged = sourceModifiedFilePaths.some(
                  (filePath) => {
                    const normalizedPath = filePath.replace(/\\/g, '/')

                    return (
                      normalizedPath === normalizedServiceWorkerAbsolutePath ||
                      normalizedPath.endsWith(
                        normalizedServiceWorkerAbsolutePath
                      ) ||
                      (serviceWorkerRelativePath
                        ? normalizedPath ===
                            serviceWorkerRelativePath.replace(/\\/g, '/') ||
                          normalizedPath.endsWith(
                            '/' + serviceWorkerRelativePath.replace(/\\/g, '/')
                          )
                        : false)
                    )
                  }
                )
              }
            }

            if (hitManifest) {
              this.pendingContentReloadEntryNames = []
              this.ctx.setPendingReloadReason('manifest')
            } else if (localeChanged) {
              this.pendingContentReloadEntryNames = []
              this.ctx.setPendingReloadReason('locales')
            } else if (serviceWorkerChanged) {
              this.pendingContentReloadEntryNames = []
              this.ctx.setPendingReloadReason('sw')
            } else {
              const changedContentEntries = getChangedContentScriptEntryNames(
                sourceModifiedFilePaths,
                this.contentScriptSourceDependencyPathsByEntry
              )
              this.lastWatchIncludedContentChanges =
                changedContentEntries.length > 0
              if (changedContentEntries.length > 0) {
                this.pendingContentReloadEntryNames = changedContentEntries
                this.awaitingSettledContentBuild = true
                ;(globalThis as any).__EXTJS_PENDING_CHROMIUM_CONTENT_RELOAD__ =
                  true
              }
              if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                console.log(
                  `[reload] changed content entries: ${this.pendingContentReloadEntryNames.join(', ') || '<none>'}`
                )
              }
              if (this.shouldEmitReloadActionEvent()) {
                emitActionEvent('reload_debug', {
                  phase: 'watch',
                  browser: this.options?.browser,
                  sourceModifiedFilePaths,
                  changedContentEntries,
                  pendingContentReloadEntryNames: [
                    ...this.pendingContentReloadEntryNames
                  ]
                })
              }
            }
          } catch (error) {
            this.logger?.warn?.(
              '[reload-debug] watchRun inspect failed:',
              String(error)
            )
          }
          done()
        }
      )
    }

    // done: apply hard reload post successful compilation
    compiler.hooks.done.tapPromise('run-browsers:module', async (stats) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        return
      }

      const inferredEntryNamesFromSourceSignatures =
        this.inferContentReloadEntryNamesFromSourceSignatures()
      const inferredHardReloadReason =
        this.inferHardReloadReasonFromSourceSignatures(compiler)
      const nextManifestSourceSignatures =
        this.collectManifestSourceSignatures(compiler)
      const nextLocaleSourceSignatures =
        this.collectLocaleSourceSignatures(compiler)
      const nextServiceWorkerSourceDependencyPaths =
        this.collectEntrypointModuleResourcePaths(
          stats.compilation,
          'background/service_worker'
        )
      const nextServiceWorkerSourceSignatures =
        this.collectSourceSignaturesFromPaths(
          nextServiceWorkerSourceDependencyPaths
        )
      const nextContentScriptSourceDependencyPaths =
        this.collectContentScriptSourceDependencyPaths(stats.compilation)
      const nextContentScriptSourceSignatures =
        this.collectContentScriptSourceSignatures(
          nextContentScriptSourceDependencyPaths
        )
      const contentScriptOutputRoot =
        this.ctx.getExtensionRoot() ||
        String(stats?.compilation?.options?.output?.path || '')
      const nextContentScriptOutputSignatures =
        this.collectContentScriptOutputSignatures(
          stats.compilation,
          contentScriptOutputRoot || undefined
        )
      const inferredEntryNamesFromOutputSignatures =
        this.inferContentReloadEntryNamesFromOutputSignatures(
          nextContentScriptOutputSignatures
        )

      // Refresh tracking data from the successful compilation:
      // - output SW path (from emitted manifest asset)
      // - source SW dependency paths (from module graph)
      this.refreshSWFromManifest(stats.compilation)
      this.serviceWorkerSourceDependencyPaths =
        nextServiceWorkerSourceDependencyPaths
      this.serviceWorkerSourceSignatures = nextServiceWorkerSourceSignatures
      this.manifestSourceSignatures = nextManifestSourceSignatures
      this.localeSourceSignatures = nextLocaleSourceSignatures
      this.contentScriptSourceDependencyPathsByEntry =
        nextContentScriptSourceDependencyPaths
      this.contentScriptSourceSignaturesByEntry =
        nextContentScriptSourceSignatures
      this.contentScriptOutputSignaturesByEntry =
        nextContentScriptOutputSignatures

      // First successful build is the extension cold-start phase.
      // Avoid any hard reload attempts here (manifest/sw/locales) because
      // Chromium can leave unpacked extensions disabled in this window.
      if (!this.hasCompletedSuccessfulBuild) {
        this.hasCompletedSuccessfulBuild = true
        this.firstSuccessfulBuildAtMs = Date.now()
        this.pendingContentReloadEntryNames = []
        this.ctx.clearPendingReloadReason()
        return
      }

      const assetsArr: Array<{name: string; emitted?: boolean}> = Array.isArray(
        stats?.compilation?.getAssets?.()
      )
        ? (stats.compilation.getAssets() as any)
        : []
      const changedAssets = assetsArr
        .filter((asset) => (asset as any)?.emitted)
        .map((asset) => String((asset as any)?.name || ''))
      const pendingReason = this.ctx.getPendingReloadReason()
      // When watchRun detected content-only changes, the manifest asset is
      // re-emitted solely because the hashed content script filename changed.
      // Suppress that inferred 'manifest' reason so the fast content-reinject
      // path runs instead of a full extension hard reload.
      const inferredAssetReason = this.inferHardReloadReasonFromChangedAssets(
        this.pendingContentReloadEntryNames.length > 0
          ? changedAssets.filter(
              (a) => String(a || '').replace(/\\/g, '/') !== 'manifest.json'
            )
          : changedAssets
      )
      const reason =
        pendingReason || inferredHardReloadReason || inferredAssetReason
      const inferredEntryNames = Array.from(
        new Set([
          ...this.inferContentReloadEntryNamesFromChangedAssets(changedAssets),
          ...inferredEntryNamesFromSourceSignatures,
          ...inferredEntryNamesFromOutputSignatures
        ])
      )
      const targetEntryNames =
        this.pendingContentReloadEntryNames.length > 0
          ? [...this.pendingContentReloadEntryNames]
          : inferredEntryNames
      if (this.shouldEmitReloadActionEvent()) {
        emitActionEvent('reload_debug', {
          phase: 'done',
          browser: this.options?.browser,
          reason: reason || null,
          changedAssets,
          inferredEntryNamesFromSourceSignatures,
          inferredEntryNamesFromOutputSignatures,
          pendingContentReloadEntryNames: [
            ...this.pendingContentReloadEntryNames
          ],
          inferredEntryNames,
          targetEntryNames
        })
      }

      if (!reason) {
        if (targetEntryNames.length > 0) {
          const ctrl =
            this.ctx.getController() ??
            (await new Promise<
              | import('../chromium-source-inspection/cdp-extension-controller').CDPExtensionController
              | undefined
            >((resolve) => {
              const timeout = setTimeout(() => resolve(undefined), 8000)
              this.ctx.onControllerReady((c) => {
                clearTimeout(timeout)
                resolve(c)
              })
            }))
          if (!ctrl) return

          const selectedEntryNames = [...targetEntryNames]
          const selectedGeneration = this.contentReloadGeneration
          const selectedRules = selectContentScriptRules(
            readContentScriptRules(
              stats.compilation,
              this.ctx.getExtensionRoot()
            ),
            selectedEntryNames
          )
          const sourceOverridesByBundleId =
            this.collectContentScriptSourceOverrides(
              stats.compilation,
              selectedRules
            )

          if (selectedRules.length === 0) {
            this.pendingContentReloadEntryNames = []
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log('[reload] selected content rules: <none>')
            }
            return
          }

          if (
            this.lastWatchIncludedContentChanges &&
            this.contentReloadQuietPeriodMs > 0
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.contentReloadQuietPeriodMs)
            )
            if (selectedGeneration !== this.contentReloadGeneration) {
              if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                console.log(
                  '[reload] skipping content reinjection during active watch churn'
                )
              }
              return
            }
          }

          let reinjectionSourceOverridesByBundleId:
            | Record<string, string>
            | undefined
          const extensionRoot = this.ctx.getExtensionRoot()
          if (extensionRoot) {
            const selectedEntryFiles = this.collectEntrypointFiles(
              stats.compilation,
              selectedEntryNames,
              extensionRoot
            )
            const expectedAssetSignatures = this.collectAssetTextSignatures(
              stats.compilation,
              selectedEntryFiles
            )
            const filesReady = await this.waitForStableContentOutputs(
              extensionRoot,
              selectedEntryFiles,
              expectedAssetSignatures
            )
            const hasSourceOverrides =
              Object.keys(sourceOverridesByBundleId).length >=
              selectedRules.length
            reinjectionSourceOverridesByBundleId = filesReady
              ? undefined
              : hasSourceOverrides
                ? sourceOverridesByBundleId
                : undefined
            if (!filesReady) {
              if (!hasSourceOverrides) {
                this.logger?.warn?.(
                  '[reload] content script assets did not stabilize before targeted reload'
                )
                return
              }
            }
          }

          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(
              `[reload] selected content rules for ${selectedEntryNames.join(', ')}`
            )
          }
          const reinjectedTabs = await ctrl.reloadMatchingTabsForContentScripts(
            selectedRules,
            {
              sourceOverridesByBundleId: reinjectionSourceOverridesByBundleId
            }
          )
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(
              `[reload] reinjected tabs for ${selectedEntryNames.join(', ')}: ${reinjectedTabs}`
            )
          }

          // Reload the extension immediately after the first reinject so Chrome
          // re-reads manifest.json with the new hashed content script path.
          // Fire-and-forget: Chrome processes the reload asynchronously while
          // the follow-up cycle continues below.
          ctrl.hardReload().catch(() => {})

          if (
            this.lastWatchIncludedContentChanges &&
            this.contentReloadFollowupMs > 0
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.contentReloadFollowupMs)
            )
            if (selectedGeneration === this.contentReloadGeneration) {
              if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                console.log(
                  `[reload] follow-up reinjection for ${selectedEntryNames.join(', ')}`
                )
              }
              const followupReinjectedTabs =
                await ctrl.reloadMatchingTabsForContentScripts(selectedRules, {
                  sourceOverridesByBundleId:
                    reinjectionSourceOverridesByBundleId
                })
              if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                console.log(
                  `[reload] follow-up reinjected tabs for ${selectedEntryNames.join(', ')}: ${followupReinjectedTabs}`
                )
              }
              if (this.contentReloadQuietPeriodMs > 0) {
                await new Promise((resolve) =>
                  setTimeout(resolve, this.contentReloadQuietPeriodMs)
                )
              }
            }
          }
          if (
            this.awaitingSettledContentBuild &&
            this.lastWatchIncludedContentChanges
          ) {
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                '[reload] preserving pending content reinjection until settled follow-up build'
              )
            }
          } else {
            this.pendingContentReloadEntryNames = []
            this.awaitingSettledContentBuild = false
          }

          if (
            this.awaitingSettledContentBuild &&
            !this.lastWatchIncludedContentChanges
          ) {
            this.pendingContentReloadEntryNames = []
            this.awaitingSettledContentBuild = false
          }

          this.broadcastSourceWatchMessage(compiler, {
            type: 'contentReloaded',
            browser: this.options?.browser,
            entries: selectedEntryNames
          })
          ;(globalThis as any).__EXTJS_PENDING_CHROMIUM_CONTENT_RELOAD__ = false
          try {
            await (globalThis as any).__EXTJS_ON_CHROMIUM_CONTENT_RELOADED__?.()
          } catch {
            // Best-effort dev-only source snapshot trigger.
          }
        }
        return
      }

      this.pendingContentReloadEntryNames = []
      ;(globalThis as any).__EXTJS_PENDING_CHROMIUM_CONTENT_RELOAD__ = false
      this.ctx.clearPendingReloadReason()

      const now = Date.now()

      if (
        this.firstSuccessfulBuildAtMs &&
        now - this.firstSuccessfulBuildAtMs <
          ChromiumHardReloadPlugin.INITIAL_RELOAD_COOLDOWN_MS
      ) {
        this.logger?.info?.(
          `[reload] skipping early reload during startup cooldown (reason:${reason})`
        )
        return
      }

      const ctrl = this.ctx.getController()
      if (!ctrl) {
        return
      }

      const developerModeStatus =
        typeof (ctrl as {getDeveloperModeStatus?: () => string})
          .getDeveloperModeStatus === 'function'
          ? (
              ctrl as {getDeveloperModeStatus: () => string}
            ).getDeveloperModeStatus()
          : 'unknown'

      if (developerModeStatus === 'disabled') {
        if (!this.warnedDevMode) {
          this.warnedDevMode = true
          this.logger?.warn?.(
            messages.chromiumDeveloperModeGuidance(this.options?.browser)
          )
        }
        return
      }

      this.logger?.info?.(`[reload] reloading extension (reason:${reason})`)
      if (this.shouldEmitReloadActionEvent()) {
        emitActionEvent('extension_reload', {
          reason: reason || 'unknown',
          browser: this.options?.browser
        })
      }
      const extensionRoot = this.ctx.getExtensionRoot()
      if (extensionRoot) {
        const manifestReady = await waitForStableManifest(extensionRoot, {
          timeoutMs: 8000
        })
        if (!manifestReady) {
          this.logger?.warn?.(
            '[reload] manifest.json did not stabilize before hard reload'
          )
          return
        }
      }
      const reloadTimeoutMs = 8000
      const ok = await Promise.race<boolean>([
        ctrl.hardReload(),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            this.logger?.warn?.(
              `[reload] hardReload timed out after ${reloadTimeoutMs}ms; continuing with source inspection`
            )
            resolve(false)
          }, reloadTimeoutMs)
        })
      ])

      if (!ok && !this.warnedHardReloadFailure) {
        this.warnedHardReloadFailure = true
        this.logger?.warn?.(
          messages.chromiumHardReloadFailed(this.options?.browser)
        )
      }

      if (typeof ctrl.reloadMatchingTabsForContentScripts === 'function') {
        const allContentRules = readContentScriptRules(
          stats.compilation,
          extensionRoot
        )
        if (allContentRules.length > 0) {
          let reinjectedTabs = 0

          if (
            typeof ctrl.reinjectMatchingTabsViaExtensionRuntime === 'function'
          ) {
            for (
              let attempt = 0;
              attempt < 3 && reinjectedTabs === 0;
              attempt++
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, attempt === 0 ? 1500 : 1000)
              )
              const runtimeReinjectedTabs =
                await ctrl.reinjectMatchingTabsViaExtensionRuntime(
                  allContentRules
                )
              reinjectedTabs = Math.max(reinjectedTabs, runtimeReinjectedTabs)

              if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                console.log(
                  `[reload] extension-runtime reinjected tabs after hard reload: ${runtimeReinjectedTabs}`
                )
              }
            }
          }
          if (
            reinjectedTabs === 0 &&
            typeof (
              ctrl as {
                getLastRuntimeReinjectionReport?: () => Record<
                  string,
                  unknown
                > | null
              }
            ).getLastRuntimeReinjectionReport === 'function'
          ) {
            const runtimeReport = (
              ctrl as {
                getLastRuntimeReinjectionReport: () => Record<
                  string,
                  unknown
                > | null
              }
            ).getLastRuntimeReinjectionReport()
            if (runtimeReport) {
              this.logger?.debug?.(
                `[reload] extension-runtime reinjection report: ${JSON.stringify(runtimeReport)}`
              )
            }
          }
          if (
            reinjectedTabs === 0 &&
            typeof ctrl.reloadMatchingTabsForContentScripts === 'function'
          ) {
            reinjectedTabs = await ctrl.reloadMatchingTabsForContentScripts(
              allContentRules,
              {
                allowCoarseCleanup: false
              }
            )
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                `[reload] direct reinjected tabs after hard reload: ${reinjectedTabs}`
              )
            }
          }
          if (
            reinjectedTabs > 0 &&
            typeof ctrl.reloadMatchingTabsForContentScripts === 'function'
          ) {
            const pageReloadedTabs =
              await ctrl.reloadMatchingTabsForContentScripts(allContentRules, {
                preferPageReload: true
              })
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                `[reload] page reloaded tabs after direct reinjection: ${pageReloadedTabs}`
              )
            }
          }
          if (
            reinjectedTabs === 0 &&
            typeof ctrl.reloadMatchingTabsForContentScripts === 'function'
          ) {
            for (let attempt = 0; attempt < 3; attempt++) {
              await new Promise((resolve) =>
                setTimeout(resolve, attempt === 0 ? 1500 : 2000)
              )
              await ctrl.reloadMatchingTabsForContentScripts(allContentRules, {
                preferPageReload: true
              })
            }
          }
        }
      }
    })
  }

  private refreshSWFromManifest(compilation: Compilation) {
    try {
      const assets = compilation.assets as unknown as Record<
        string,
        {
          source: () => unknown
        }
      >
      const manifestStr = assets['manifest.json']
        ? String(assets['manifest.json'].source())
        : ''
      if (!manifestStr) return
      const parsed = JSON.parse(manifestStr) as {
        background?: {service_worker?: unknown}
      }
      const sw = parsed?.background?.service_worker as unknown
      if (typeof sw === 'string' && sw) {
        const extRoot = this.ctx.getExtensionRoot() || ''
        const abs = extRoot ? path.join(extRoot, sw) : undefined
        this.ctx.setServiceWorkerPaths(sw, abs)
      }
    } catch {
      // ignore
    }
  }

  private collectServiceWorkerSourceSignatures(): Map<string, string> {
    return this.collectSourceSignaturesFromPaths(
      this.serviceWorkerSourceDependencyPaths
    )
  }

  private collectManifestSourceSignatures(
    compiler: Compiler
  ): Map<string, string> {
    return this.collectSourceSignaturesFromPaths(
      this.getWatchedManifestSourcePaths(compiler)
    )
  }

  private collectLocaleSourceSignatures(
    compiler: Compiler
  ): Map<string, string> {
    const compilerContextRoot = String(
      compiler?.options?.context || ''
    ).replace(/\\/g, '/')

    if (!compilerContextRoot) return new Map()

    const localesRoot = path.join(compilerContextRoot, 'src', '_locales')
    const discoveredLocaleFiles: string[] = []

    const walk = (dirPath: string) => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dirPath, {withFileTypes: true})
      } catch {
        return
      }

      for (const entry of entries) {
        const absoluteEntryPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          walk(absoluteEntryPath)
          continue
        }

        if (entry.isFile() && absoluteEntryPath.endsWith('.json')) {
          discoveredLocaleFiles.push(absoluteEntryPath.replace(/\\/g, '/'))
        }
      }
    }

    walk(localesRoot)

    return this.collectSourceSignaturesFromPaths(discoveredLocaleFiles)
  }

  private collectSourceSignaturesFromPaths(
    dependencyPaths: Iterable<string>
  ): Map<string, string> {
    const signatures = new Map<string, string>()

    for (const dependencyPath of dependencyPaths) {
      const normalizedDependencyPath = String(dependencyPath).replace(
        /\\/g,
        '/'
      )
      const signature = this.readSourceFileSignature(normalizedDependencyPath)
      if (!signature) continue
      signatures.set(normalizedDependencyPath, signature)
    }

    return signatures
  }

  private collectContentScriptSourceDependencyPaths(
    compilation: Compilation
  ): Map<string, Set<string>> {
    return collectContentScriptDependencyPaths(compilation)
  }

  private collectContentScriptSourceSignatures(
    dependencyPathsByEntry: Map<string, Set<string>>
  ) {
    const nextSignatures = new Map<string, Map<string, string>>()

    for (const [
      entryName,
      dependencyPaths
    ] of dependencyPathsByEntry.entries()) {
      const signatures = new Map<string, string>()
      for (const dependencyPath of dependencyPaths) {
        const signature = this.readSourceFileSignature(dependencyPath)
        if (!signature) continue
        signatures.set(dependencyPath, signature)
      }
      nextSignatures.set(entryName, signatures)
    }

    return nextSignatures
  }

  private inferContentReloadEntryNamesFromSourceSignatures(): string[] {
    const changedEntries = new Set<string>()

    for (const [
      entryName,
      dependencySignatures
    ] of this.contentScriptSourceSignaturesByEntry.entries()) {
      for (const [dependencyPath, previousSignature] of dependencySignatures) {
        const nextSignature = this.readSourceFileSignature(dependencyPath)
        if (!nextSignature || nextSignature !== previousSignature) {
          changedEntries.add(entryName)
          break
        }
      }
    }

    return Array.from(changedEntries).sort()
  }

  private inferContentReloadEntryNamesFromOutputSignatures(
    nextOutputSignaturesByEntry: Map<string, Map<string, string>>
  ): string[] {
    const changedEntries = new Set<string>()

    for (const [
      entryName,
      nextOutputSignatures
    ] of nextOutputSignaturesByEntry.entries()) {
      const previousOutputSignatures =
        this.contentScriptOutputSignaturesByEntry.get(entryName)
      if (!previousOutputSignatures || previousOutputSignatures.size === 0) {
        continue
      }
      if (previousOutputSignatures.size !== nextOutputSignatures.size) {
        changedEntries.add(entryName)
        continue
      }
      for (const [outputFile, previousSignature] of previousOutputSignatures) {
        const nextSignature = nextOutputSignatures.get(outputFile)
        if (!nextSignature || nextSignature !== previousSignature) {
          changedEntries.add(entryName)
          break
        }
      }
    }

    return Array.from(changedEntries).sort()
  }

  private inferHardReloadReasonFromSourceSignatures(
    compiler: Compiler
  ): 'manifest' | 'locales' | 'sw' | undefined {
    const nextManifestSourceSignatures =
      this.collectManifestSourceSignatures(compiler)
    if (
      this.haveSourceSignaturesChanged(
        this.manifestSourceSignatures,
        nextManifestSourceSignatures
      )
    ) {
      return 'manifest'
    }

    const nextLocaleSourceSignatures =
      this.collectLocaleSourceSignatures(compiler)
    if (
      this.haveSourceSignaturesChanged(
        this.localeSourceSignatures,
        nextLocaleSourceSignatures
      )
    ) {
      return 'locales'
    }

    const nextServiceWorkerSourceSignatures =
      this.collectServiceWorkerSourceSignatures()
    if (
      this.haveSourceSignaturesChanged(
        this.serviceWorkerSourceSignatures,
        nextServiceWorkerSourceSignatures
      )
    ) {
      return 'sw'
    }

    return undefined
  }

  private haveSourceSignaturesChanged(
    previousSignatures: Map<string, string>,
    nextSignatures: Map<string, string>
  ): boolean {
    if (previousSignatures.size === 0) return false
    if (previousSignatures.size !== nextSignatures.size) return true

    for (const [dependencyPath, previousSignature] of previousSignatures) {
      const nextSignature = nextSignatures.get(dependencyPath)
      if (!nextSignature || nextSignature !== previousSignature) {
        return true
      }
    }

    return false
  }

  private inferContentReloadEntryNamesFromChangedAssets(
    changedAssets: string[]
  ): string[] {
    const entries = new Set<string>()
    for (const assetName of changedAssets) {
      const normalizedAssetName = String(assetName || '').replace(/\\/g, '/')
      const canonicalAsset =
        parseCanonicalContentScriptAsset(normalizedAssetName)
      if (canonicalAsset) {
        entries.add(getCanonicalContentScriptEntryName(canonicalAsset.index))
        continue
      }

      const hotMatch =
        /^hot\/content_scripts\/content-(\d+)\.[^.]+\.json$/.exec(
          normalizedAssetName
        )
      if (!hotMatch) {
        if (!isCanonicalContentScriptAsset(normalizedAssetName)) continue
      }
      if (!hotMatch) continue
      entries.add(getCanonicalContentScriptEntryName(Number(hotMatch[1])))
    }
    return Array.from(entries)
  }

  private inferHardReloadReasonFromChangedAssets(
    changedAssets: string[]
  ): 'manifest' | 'locales' | 'sw' | undefined {
    for (const assetName of changedAssets) {
      const normalizedAssetName = String(assetName || '').replace(/\\/g, '/')
      if (!normalizedAssetName) continue

      if (normalizedAssetName === 'manifest.json') {
        return 'manifest'
      }

      if (/(^|\/)_locales\/.+\.json$/i.test(normalizedAssetName)) {
        return 'locales'
      }

      if (
        /(^|\/)background\/(service_worker|script)\.(m?js|cjs)$/i.test(
          normalizedAssetName
        )
      ) {
        return 'sw'
      }
    }

    return undefined
  }

  private readSourceFileSignature(
    absoluteFilePath: string
  ): string | undefined {
    try {
      const stats = fs.statSync(absoluteFilePath)
      if (!stats.isFile()) return undefined
      return `${stats.size}:${stats.mtimeMs}`
    } catch {
      return undefined
    }
  }

  private collectContentScriptOutputSignatures(
    compilation: Compilation,
    extensionRoot?: string
  ): Map<string, Map<string, string>> {
    const outputSignaturesByEntry = new Map<string, Map<string, string>>()
    const entrypoints: Map<string, any> | undefined = (compilation as any)
      ?.entrypoints

    if (!entrypoints || !extensionRoot) {
      return outputSignaturesByEntry
    }

    for (const [entryName] of entrypoints.entries()) {
      if (!isContentScriptEntryName(entryName)) continue
      const entryFiles = this.collectEntrypointFiles(
        compilation,
        [entryName],
        extensionRoot
      )
      const outputSignatures = new Map<string, string>()
      for (const entryFile of entryFiles) {
        const absoluteEntryFilePath = path.join(extensionRoot, entryFile)
        const signature = this.readSourceFileSignature(absoluteEntryFilePath)
        if (!signature) continue
        outputSignatures.set(entryFile, signature)
      }
      if (outputSignatures.size > 0) {
        outputSignaturesByEntry.set(entryName, outputSignatures)
      }
    }

    return outputSignaturesByEntry
  }

  private collectEntrypointModuleResourcePaths(
    compilation: Compilation,
    entrypointName: string
  ): Set<string> {
    const collectedResourcePaths = new Set<string>()

    const entrypoints: Map<string, any> | undefined = (compilation as any)
      ?.entrypoints

    const entrypoint = entrypoints?.get?.(entrypointName)
    if (!entrypoint) {
      return collectedResourcePaths
    }

    const chunkGraph: any = (compilation as any)?.chunkGraph
    if (!chunkGraph) {
      return collectedResourcePaths
    }

    const entrypointChunks: any[] = Array.from(
      (entrypoint as any)?.chunks || []
    )

    for (const chunk of entrypointChunks) {
      const modulesIterable: Iterable<any> | undefined =
        chunkGraph.getChunkModulesIterable?.(chunk) ||
        chunkGraph.getChunkModulesIterableBySourceType?.(chunk, 'javascript') ||
        chunkGraph.getChunkModules?.(chunk)

      if (!modulesIterable) continue

      for (const module of modulesIterable as any) {
        const resourcePath = normalizeModuleResourcePath(
          (module as any)?.resource ||
            (module as any)?.rootModule?.resource ||
            (module as any)?.originalSource?.()?.resource
        )

        if (resourcePath) {
          collectedResourcePaths.add(resourcePath)
        }
      }
    }

    return collectedResourcePaths
  }

  private collectEntrypointFiles(
    compilation: Compilation,
    entrypointNames: string[],
    extensionRoot?: string
  ): string[] {
    const entrypoints: Map<string, any> | undefined = (compilation as any)
      ?.entrypoints
    if (!entrypoints) {
      return this.deriveCanonicalContentEntryFiles(
        entrypointNames,
        extensionRoot
      )
    }

    const collectedFiles = new Set<string>()

    for (const entrypointName of entrypointNames) {
      const entrypoint = entrypoints.get?.(entrypointName)
      const entryFiles: string[] =
        typeof entrypoint?.getFiles === 'function' ? entrypoint.getFiles() : []

      for (const file of entryFiles) {
        const normalizedFile = String(file || '').replace(/\\/g, '/')
        if (!normalizedFile || normalizedFile.endsWith('.map')) continue
        if (normalizedFile.startsWith('hot/')) continue
        collectedFiles.add(normalizedFile)
      }
    }

    if (collectedFiles.size === 0) {
      return this.deriveCanonicalContentEntryFiles(
        entrypointNames,
        extensionRoot
      )
    }

    return Array.from(collectedFiles)
  }

  private deriveCanonicalContentEntryFiles(
    entrypointNames: string[],
    extensionRoot?: string
  ): string[] {
    const collectedFiles = new Set<string>()

    for (const entrypointName of entrypointNames) {
      const normalizedEntrypointName = String(entrypointName || '').replace(
        /\\/g,
        '/'
      )
      if (!normalizedEntrypointName) continue

      try {
        const jsRelativePath = `${normalizedEntrypointName}.js`
        if (
          !extensionRoot ||
          fs.existsSync(path.join(extensionRoot, jsRelativePath))
        ) {
          collectedFiles.add(jsRelativePath)
        }

        if (!extensionRoot) continue

        const cssRelativePath = `${normalizedEntrypointName}.css`
        if (fs.existsSync(path.join(extensionRoot, cssRelativePath))) {
          collectedFiles.add(cssRelativePath)
        }
      } catch {
        // Ignore fs lookup failures and fall back to JS stabilization.
      }
    }

    return Array.from(collectedFiles)
  }

  private async waitForStableContentOutputs(
    extensionRoot: string,
    entryFiles: string[],
    expectedAssetSignatures: Map<string, string> = new Map(),
    timeoutMs: number = 8000,
    pollIntervalMs: number = 150,
    stableReadsRequired: number = 2
  ): Promise<boolean> {
    const normalizedEntryFiles = entryFiles
      .map((file) => String(file || '').replace(/\\/g, '/'))
      .filter(Boolean)

    if (normalizedEntryFiles.length === 0) {
      return true
    }

    const start = Date.now()
    let lastSignature = ''
    let stableReads = 0
    while (Date.now() - start < timeoutMs) {
      const referencedFiles = new Set<string>(normalizedEntryFiles)
      const signatureParts: string[] = []
      let allFilesReady = true

      for (const entryFile of normalizedEntryFiles) {
        const absoluteEntryFilePath = path.join(extensionRoot, entryFile)
        const source = this.readFileTextSafe(absoluteEntryFilePath)
        const expectedAssetSignature = expectedAssetSignatures.get(entryFile)
        const signature = expectedAssetSignature
          ? this.readTextSignature(source)
          : this.readStableFileSignature(absoluteEntryFilePath)
        if (!signature) {
          allFilesReady = false
          break
        }
        if (expectedAssetSignature && signature !== expectedAssetSignature) {
          allFilesReady = false
          break
        }
        signatureParts.push(`${entryFile}:${signature}`)

        if (entryFile.endsWith('.js')) {
          if (!source) {
            allFilesReady = false
            break
          }
          for (const referencedFile of this.extractReferencedOutputFiles(
            source
          )) {
            referencedFiles.add(referencedFile)
          }
        }
      }

      if (!allFilesReady) {
        lastSignature = ''
        stableReads = 0
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        continue
      }

      for (const referencedFile of referencedFiles) {
        if (normalizedEntryFiles.includes(referencedFile)) continue
        const absoluteReferencedFilePath = path.join(
          extensionRoot,
          referencedFile
        )
        const signature = this.readStableFileSignature(
          absoluteReferencedFilePath
        )
        if (!signature) {
          allFilesReady = false
          break
        }
        signatureParts.push(`${referencedFile}:${signature}`)
      }

      if (!allFilesReady) {
        lastSignature = ''
        stableReads = 0
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        continue
      }

      const currentSignature = signatureParts.sort().join('|')
      if (currentSignature === lastSignature) {
        stableReads += 1
      } else {
        lastSignature = currentSignature
        stableReads = 1
      }

      if (stableReads >= stableReadsRequired) {
        return true
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    return false
  }

  private readStableFileSignature(
    absoluteFilePath: string
  ): string | undefined {
    try {
      const stats = fs.statSync(absoluteFilePath)
      if (!stats.isFile()) return undefined
      return `${stats.size}:${stats.mtimeMs}`
    } catch {
      return undefined
    }
  }

  private readFileTextSafe(absoluteFilePath: string): string | undefined {
    try {
      return fs.readFileSync(absoluteFilePath, 'utf-8')
    } catch {
      return undefined
    }
  }

  private collectAssetTextSignatures(
    compilation: Compilation,
    assetNames: string[]
  ): Map<string, string> {
    const signatures = new Map<string, string>()

    for (const assetName of assetNames) {
      const normalizedAssetName = String(assetName || '').replace(/\\/g, '/')
      if (!normalizedAssetName) continue

      try {
        const asset =
          compilation.getAsset?.(normalizedAssetName) ||
          (compilation as any)?.assets?.[normalizedAssetName]
        const source =
          asset && typeof asset.source?.source === 'function'
            ? asset.source.source()
            : asset && typeof asset.source === 'function'
              ? asset.source()
              : undefined
        const signature = this.readTextSignature(
          typeof source === 'string' || Buffer.isBuffer(source)
            ? source.toString()
            : undefined
        )
        if (signature) {
          signatures.set(normalizedAssetName, signature)
        }
      } catch {
        // Ignore missing in-memory assets and fall back to disk stabilization.
      }
    }

    return signatures
  }

  private collectContentScriptSourceOverrides(
    compilation: Compilation,
    rules: Array<{index: number}>
  ): Record<string, string> {
    const overrides: Record<string, string> = {}

    for (const rule of rules) {
      const bundleId = getCanonicalContentScriptEntryName(rule.index)
      const assetName = `${bundleId}.js`

      try {
        const asset =
          compilation.getAsset?.(assetName) ||
          (compilation as any)?.assets?.[assetName]
        const source =
          asset && typeof asset.source?.source === 'function'
            ? asset.source.source()
            : asset && typeof asset.source === 'function'
              ? asset.source()
              : undefined
        const text =
          typeof source === 'string' || Buffer.isBuffer(source)
            ? source.toString()
            : ''
        if (text) {
          overrides[bundleId] = text
        }
      } catch {
        // Best-effort fallback for targeted reinjection.
      }
    }

    return overrides
  }

  private readTextSignature(source: string | undefined): string | undefined {
    if (typeof source !== 'string') return undefined

    let hash = 0
    for (let index = 0; index < source.length; index++) {
      hash = (hash * 31 + source.charCodeAt(index)) >>> 0
    }

    return `${source.length}:${hash.toString(16)}`
  }

  private extractReferencedOutputFiles(source: string): string[] {
    const matches = source.match(
      /(?:content_scripts|assets)\/[^"'`\s)]+\.(?:css|js|json|png|jpg|jpeg|svg|gif|webp|ico|avif)/g
    )
    return Array.from(new Set(matches || []))
  }

  private shouldEmitReloadActionEvent(): boolean {
    return Boolean(this.options?.source || this.options?.watchSource)
  }

  private broadcastSourceWatchMessage(
    compiler: Compiler,
    payload: Record<string, unknown>
  ) {
    const webSocketServer = (compiler?.options as any)?.webSocketServer
    const clients = webSocketServer?.clients
    if (!clients || typeof clients.forEach !== 'function') {
      return
    }

    const message = JSON.stringify(payload)
    clients.forEach((client: any) => {
      try {
        if (typeof client?.send === 'function') {
          client.send(message)
        }
      } catch {
        // Best-effort developer-only broadcast.
      }
    })
  }
}
