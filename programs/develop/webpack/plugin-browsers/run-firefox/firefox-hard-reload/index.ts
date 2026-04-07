// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {Compilation, Compiler} from '@rspack/core'
import type {FirefoxContext} from '../firefox-context'
import type {FirefoxPluginRuntime} from '../firefox-types'
import {emitActionEvent} from '../../browsers-lib/source-output'
import {
  collectContentScriptDependencyPaths,
  getChangedContentScriptEntryNames,
  isContentScriptEntryName,
  isCanonicalContentScriptAsset,
  readContentScriptRules,
  selectContentScriptRules
} from '../../browsers-lib/content-script-targets'
import {
  getCanonicalContentScriptEntryName,
  parseCanonicalContentScriptAsset
} from '../../../plugin-web-extension/feature-scripts/contracts'

export class FirefoxHardReloadPlugin {
  private readonly host: FirefoxPluginRuntime
  private readonly ctx: FirefoxContext
  private hasSeenFirstSuccessfulDone = false
  private serviceWorkerSourceDependencyPaths: Set<string> = new Set()
  private serviceWorkerSourceSignatures: Map<string, string> = new Map()
  private manifestSourceSignatures: Map<string, string> = new Map()
  private localeSourceSignatures: Map<string, string> = new Map()
  private contentScriptSourceDependencyPathsByEntry: Map<string, Set<string>> =
    new Map()
  private contentScriptOutputSignaturesByEntry: Map<
    string,
    Map<string, string>
  > = new Map()
  private pendingContentReloadEntryNames: string[] = []
  private contentReloadGeneration = 0
  private contentReloadQuietPeriodMs = 1200
  private contentReloadFollowupMs = 1200
  private lastWatchIncludedContentChanges = false
  private awaitingSettledContentBuild = false

  constructor(host: FirefoxPluginRuntime, ctx: FirefoxContext) {
    this.host = host
    this.ctx = ctx
  }

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

  apply(compiler: Compiler) {
    if (compiler?.hooks?.watchRun?.tapAsync) {
      compiler.hooks.watchRun.tapAsync(
        'run-browsers:watch',
        (compilation, done) => {
          try {
            this.contentReloadGeneration += 1
            const files =
              (compilation as any)?.modifiedFiles || new Set<string>()
            const normalized = Array.from(files).map((p: unknown) =>
              String(p).replace(/\\/g, '/')
            )
            const compilerContextRoot = String(
              compiler?.options?.context || ''
            ).replace(/\\/g, '/')
            const filesInCurrentCompilerContext = compilerContextRoot
              ? normalized.filter(
                  (filePath) =>
                    filePath === compilerContextRoot ||
                    filePath.startsWith(`${compilerContextRoot}/`)
                )
              : normalized
            const normalizedOutputPath = String(
              compiler?.options?.output?.path || ''
            ).replace(/\\/g, '/')
            const watchedModifiedFilePaths = compilerContextRoot
              ? filesInCurrentCompilerContext
              : normalized
            const sourceModifiedFilePaths = watchedModifiedFilePaths.filter(
              (filePath) =>
                !(
                  normalizedOutputPath &&
                  (filePath === normalizedOutputPath ||
                    filePath.startsWith(`${normalizedOutputPath}/`))
                )
            )
            const normalizedManifestSourcePaths =
              this.getWatchedManifestSourcePaths(compiler)

            const hitManifest = sourceModifiedFilePaths.some((filePath) => {
              if (normalizedManifestSourcePaths.length > 0) {
                return normalizedManifestSourcePaths.includes(filePath)
              }
              return /(^|\/)manifest\.json$/i.test(filePath)
            })
            const hitLocales = sourceModifiedFilePaths.some((filePath) => {
              if (compilerContextRoot) {
                return filePath.startsWith(
                  `${compilerContextRoot}/src/_locales/`
                )
              }
              return /(^|\/)__?locales\/.+\.json$/i.test(filePath)
            })
            const hitServiceWorker = sourceModifiedFilePaths.some((p) =>
              /(^|\/)(service_worker|background)\.(m?js|cjs|ts)$/i.test(p)
            )

            if (hitManifest) {
              this.pendingContentReloadEntryNames = []
              this.ctx.setPendingReloadReason?.('manifest')
            } else if (hitLocales) {
              this.pendingContentReloadEntryNames = []
              this.ctx.setPendingReloadReason?.('locales')
            } else if (hitServiceWorker) {
              this.pendingContentReloadEntryNames = []
              this.ctx.setPendingReloadReason?.('sw')
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
                ;(globalThis as any).__EXTJS_PENDING_FIREFOX_CONTENT_RELOAD__ =
                  true
              }
              if (this.shouldEmitReloadActionEvent()) {
                emitActionEvent('reload_debug', {
                  phase: 'watch',
                  browser: this.host.browser,
                  sourceModifiedFilePaths,
                  hitManifest,
                  hitLocales,
                  hitServiceWorker,
                  changedContentEntries,
                  pendingContentReloadEntryNames: [
                    ...this.pendingContentReloadEntryNames
                  ]
                })
              }
            }
          } catch (error) {
            this.ctx.logger?.warn?.(
              '[reload] watchRun inspect failed:',
              String(error)
            )
          }
          done()
        }
      )
    }

    // On build done, compute changed assets and request hard reload via controller
    compiler.hooks.done.tapAsync('run-firefox:module', async (stats, done) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        done()
        return
      }

      try {
        const compilation = stats?.compilation
        const inferredHardReloadReason =
          this.inferHardReloadReasonFromSourceSignatures(compiler)
        const nextManifestSourceSignatures =
          this.collectManifestSourceSignatures(compiler)
        const nextLocaleSourceSignatures =
          this.collectLocaleSourceSignatures(compiler)
        const nextServiceWorkerSourceDependencyPaths =
          this.collectEntrypointModuleResourcePaths(
            compilation,
            'background/service_worker'
          )
        const nextServiceWorkerSourceSignatures =
          this.collectSourceSignaturesFromPaths(
            nextServiceWorkerSourceDependencyPaths
          )
        this.refreshContentScriptSourceDependencyPaths(compilation)
        this.serviceWorkerSourceDependencyPaths =
          nextServiceWorkerSourceDependencyPaths
        this.serviceWorkerSourceSignatures = nextServiceWorkerSourceSignatures
        this.manifestSourceSignatures = nextManifestSourceSignatures
        this.localeSourceSignatures = nextLocaleSourceSignatures
        const changed = this.collectChangedAssetNames(compilation)
        const contentScriptOutputRoot =
          this.ctx.getExtensionRoot() ||
          String(compilation?.options?.output?.path || '')
        const nextContentScriptOutputSignatures =
          this.collectContentScriptOutputSignatures(
            compilation,
            contentScriptOutputRoot || undefined
          )
        const inferredEntryNamesFromOutputSignatures =
          this.inferContentReloadEntryNamesFromOutputSignatures(
            nextContentScriptOutputSignatures
          )

        const controller = (this.host as any)?.rdpController as
          | {
              hardReload: (c: any, assets: string[]) => Promise<void>
              reloadMatchingTabsForContentScripts?: (
                rules: any[]
              ) => Promise<number>
            }
          | undefined

        if (!this.hasSeenFirstSuccessfulDone) {
          this.hasSeenFirstSuccessfulDone = true
          this.contentScriptOutputSignaturesByEntry =
            nextContentScriptOutputSignatures
          this.pendingContentReloadEntryNames = []
          this.awaitingSettledContentBuild = false
          this.lastWatchIncludedContentChanges = false
          this.ctx.clearPendingReloadReason?.()

          // Reload tabs that loaded before the extension finished installing
          // so their content scripts get injected on the first build.
          if (
            controller &&
            typeof controller.reloadMatchingTabsForContentScripts === 'function'
          ) {
            const allRules = readContentScriptRules(
              compilation,
              this.ctx.getExtensionRoot()
            )
            if (allRules.length > 0) {
              controller
                .reloadMatchingTabsForContentScripts(allRules)
                .catch(() => {})
            }
          }

          done()
          return
        }

        if (controller && typeof controller.hardReload === 'function') {
          // When watchRun detected content-only changes, the manifest asset is
          // re-emitted solely because the hashed content script filename changed.
          // Suppress that inferred 'manifest' reason so the fast content-reinject
          // path runs instead of a full add-on hard reload.
          const inferredAssetReason =
            this.inferHardReloadReasonFromChangedAssets(
              this.pendingContentReloadEntryNames.length > 0
                ? changed.filter(
                    (a) =>
                      String(a || '').replace(/\\/g, '/') !== 'manifest.json'
                  )
                : changed
            )
          const reason =
            this.ctx.getPendingReloadReason?.() ||
            inferredHardReloadReason ||
            inferredAssetReason
          const inferredEntryNames = Array.from(
            new Set([
              ...this.inferContentReloadEntryNamesFromChangedAssets(changed),
              ...inferredEntryNamesFromOutputSignatures
            ])
          )
          this.contentScriptOutputSignaturesByEntry =
            nextContentScriptOutputSignatures
          const targetEntryNames =
            this.pendingContentReloadEntryNames.length > 0
              ? [...this.pendingContentReloadEntryNames]
              : inferredEntryNames

          if (this.shouldEmitReloadActionEvent()) {
            emitActionEvent('reload_debug', {
              phase: 'done',
              browser: this.host.browser,
              reason: reason || null,
              pendingContentReloadEntryNames: [
                ...this.pendingContentReloadEntryNames
              ],
              inferredEntryNamesFromOutputSignatures,
              inferredEntryNames,
              targetEntryNames,
              changedAssets: changed
            })
          }

          if (!reason && targetEntryNames.length === 0) {
            this.pendingContentReloadEntryNames = []
            this.awaitingSettledContentBuild = false
            this.lastWatchIncludedContentChanges = false
            done()
            return
          }

          if (
            !reason &&
            targetEntryNames.length > 0 &&
            typeof controller.reloadMatchingTabsForContentScripts === 'function'
          ) {
            const selectedEntryNames = targetEntryNames
            const selectedGeneration = this.contentReloadGeneration
            const selectedRules = selectContentScriptRules(
              readContentScriptRules(compilation, this.ctx.getExtensionRoot()),
              selectedEntryNames
            )
            if (selectedRules.length > 0) {
              // Firefox reinject is a full page reload via RDP — the browser
              // reads files from disk at navigation time, so waiting for stable
              // output signatures is unnecessary and can stall on references to
              // non-existent files (e.g. CSS assets mentioned in wrapper code).
              if (
                this.lastWatchIncludedContentChanges &&
                this.contentReloadQuietPeriodMs > 0
              ) {
                await new Promise((resolve) =>
                  setTimeout(resolve, this.contentReloadQuietPeriodMs)
                )
                if (selectedGeneration !== this.contentReloadGeneration) {
                  done()
                  return
                }
              }
              await controller.reloadMatchingTabsForContentScripts(
                selectedRules
              )

              if (
                this.lastWatchIncludedContentChanges &&
                this.contentReloadFollowupMs > 0
              ) {
                await new Promise((resolve) =>
                  setTimeout(resolve, this.contentReloadFollowupMs)
                )
                if (selectedGeneration === this.contentReloadGeneration) {
                  await controller.reloadMatchingTabsForContentScripts(
                    selectedRules
                  )
                }
              }
            }

            ;(globalThis as any).__EXTJS_PENDING_FIREFOX_CONTENT_RELOAD__ =
              false
            try {
              await (
                globalThis as any
              ).__EXTJS_ON_FIREFOX_CONTENT_RELOADED__?.()
            } catch {
              // Best-effort dev-only source snapshot trigger.
            }

            if (
              this.awaitingSettledContentBuild &&
              this.lastWatchIncludedContentChanges
            ) {
              // Keep the pending entries alive for the first settled no-change build.
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
            done()
            return
          }

          if (this.shouldEmitReloadActionEvent()) {
            emitActionEvent('extension_reload', {
              reason: reason || 'unknown',
              browser: this.host.browser
            })
          }

          this.pendingContentReloadEntryNames = []
          ;(globalThis as any).__EXTJS_PENDING_FIREFOX_CONTENT_RELOAD__ = false
          this.ctx.clearPendingReloadReason?.()
          await controller.hardReload(stats.compilation, changed)

          if (
            typeof controller.reloadMatchingTabsForContentScripts === 'function'
          ) {
            const allContentRules = readContentScriptRules(
              compilation,
              this.ctx.getExtensionRoot()
            )
            if (allContentRules.length > 0) {
              await controller.reloadMatchingTabsForContentScripts(
                allContentRules
              )
            }
          }

          if (this.host.watchSource || this.host.source) {
            ;(this.host as any).__extjsForceSourceReinspect = true
          }
        }
      } catch {
        // Ignore
      }

      done()
    })
  }

  private shouldEmitReloadActionEvent(): boolean {
    return Boolean(this.host.source || this.host.watchSource)
  }

  private refreshContentScriptSourceDependencyPaths(compilation: any) {
    this.contentScriptSourceDependencyPathsByEntry =
      collectContentScriptDependencyPaths(compilation)

    if (this.shouldEmitReloadActionEvent()) {
      const summary = Array.from(
        this.contentScriptSourceDependencyPathsByEntry.entries()
      )
        .map(([entryName, dependencyPaths]) => {
          const matches = [...dependencyPaths].filter((dependencyPath) =>
            /contentapp\.(t|j)sx?$/i.test(dependencyPath)
          )
          return `${entryName}:${dependencyPaths.size}${matches.length ? `:has-ContentApp=${matches.join('|')}` : ''}`
        })
        .join(', ')
      emitActionEvent('reload_debug', {
        phase: 'dependencies',
        browser: this.host.browser,
        summary: summary || '<none>'
      })
    }
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
      this.collectSourceSignaturesFromPaths(
        this.serviceWorkerSourceDependencyPaths
      )
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

  private collectChangedAssetNames(
    compilation: Compilation | undefined
  ): string[] {
    const changed = new Set<string>()
    const assetsArr: Array<{name: string; emitted?: boolean}> = Array.isArray(
      compilation?.getAssets?.()
    )
      ? (compilation!.getAssets() as any)
      : []

    for (const asset of assetsArr) {
      if (!(asset as any)?.emitted) continue
      const assetName = String((asset as any)?.name || '').replace(/\\/g, '/')
      if (assetName) changed.add(assetName)
    }

    const assetsInfo: unknown = (compilation as any)?.assetsInfo
    if (assetsInfo instanceof Map) {
      for (const key of assetsInfo.keys()) {
        const assetName = String(key || '').replace(/\\/g, '/')
        if (assetName) changed.add(assetName)
      }
    }

    return Array.from(changed)
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

  private inferContentReloadEntryNamesFromChangedAssets(
    changedAssets: string[]
  ): string[] {
    const entries = new Set<string>()
    for (const assetName of changedAssets) {
      const normalizedAssetName = String(assetName || '').replace(/\\/g, '/')
      if (!isCanonicalContentScriptAsset(normalizedAssetName)) continue
      const canonicalAsset =
        parseCanonicalContentScriptAsset(normalizedAssetName)
      if (!canonicalAsset) continue
      entries.add(getCanonicalContentScriptEntryName(canonicalAsset.index))
    }
    return Array.from(entries)
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
        const resourcePath: unknown =
          (module as any)?.resource ||
          (module as any)?.rootModule?.resource ||
          (module as any)?.originalSource?.()?.resource

        if (typeof resourcePath === 'string' && resourcePath.length > 0) {
          collectedResourcePaths.add(resourcePath.replace(/\\/g, '/'))
        }
      }
    }

    return collectedResourcePaths
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
      const entryFiles = this.collectEntrypointFiles(compilation, [entryName])
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

  private collectEntrypointFiles(
    compilation: any,
    entrypointNames: string[]
  ): string[] {
    const collectedFiles = new Set<string>()
    const entrypoints: Map<string, any> | undefined = compilation?.entrypoints
    if (!entrypoints) return []

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

    return Array.from(collectedFiles)
  }

  private async waitForStableContentOutputs(
    extensionRoot: string,
    entryFiles: string[],
    timeoutMs: number = 8000,
    pollIntervalMs: number = 150,
    stableReadsRequired: number = 2
  ): Promise<boolean> {
    const normalizedEntryFiles = entryFiles
      .map((file) => String(file || '').replace(/\\/g, '/'))
      .filter(Boolean)

    if (normalizedEntryFiles.length === 0) return true

    const start = Date.now()
    let lastSignature = ''
    let stableReads = 0

    while (Date.now() - start < timeoutMs) {
      const referencedFiles = new Set<string>(normalizedEntryFiles)
      const signatureParts: string[] = []
      let allFilesReady = true

      for (const entryFile of normalizedEntryFiles) {
        const absoluteEntryFilePath = path.join(extensionRoot, entryFile)
        const signature = this.readStableFileSignature(absoluteEntryFilePath)
        if (!signature) {
          allFilesReady = false
          break
        }
        signatureParts.push(`${entryFile}:${signature}`)

        if (entryFile.endsWith('.js')) {
          const source = this.readFileTextSafe(absoluteEntryFilePath)
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

  private extractReferencedOutputFiles(source: string): string[] {
    const matches = source.match(
      /(?:content_scripts|assets)\/[^"'`\s)]+\.(?:css|js|json|png|jpg|jpeg|svg|gif|webp|ico|avif)/g
    )
    return Array.from(new Set(matches || []))
  }
}
