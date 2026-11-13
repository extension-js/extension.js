// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler} from '@rspack/core'
import {prependToEmittedAsset} from '../../../lib/asset-source-maps'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
import {
  buildMainWorldBridgePairingSource,
  MAIN_WORLD_BRIDGE_ENTRY,
  MAIN_WORLD_BRIDGE_PAIRING_MARK
} from '../scripts-lib/main-world-bridge-pairing'
import {
  findBridgePairingPages,
  findRuntimeMainWorldEntries
} from '../scripts-lib/runtime-main-world-scripts'
import {resolveMainWorldBridgeSourcePath} from './add-content-script-wrapper/get-bridge-scripts'
import {getBaseReaderRequirements} from './prune-main-world-bridges'

const BACKGROUND_ASSET =
  /(^|\/)background\/(?:service_worker|scripts?|index)\.js$/i

// The file that starts a page entry, which runs ahead of the page's code.
function pageBundleNames(compilation: Compilation, page: string): string[] {
  const fallback = [`${page}.js`]

  try {
    const chunk = compilation.entrypoints.get(page)?.getEntrypointChunk()
    const files = [...(chunk?.files || [])].filter((file) =>
      /\.js$/i.test(file)
    )

    return files.length > 0 ? files : fallback
  } catch {
    return fallback
  }
}

// A declared MAIN world group ships with a bridge that publishes the
// extension base. A runtime registration gets the same pair on Gecko.
export class PairRuntimeMainWorldBridges {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList
  private readonly pageList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
    this.pageList = options.pageList
  }

  public apply(compiler: Compiler): void {
    // A Chromium MAIN bundle reads the base off its own stack.
    if (!isGeckoBasedBrowser(String(this.browser))) return

    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    const registered = findRuntimeMainWorldEntries({
      includeList: this.includeList,
      pageList: this.pageList,
      manifestDir,
      projectPath
    })
    if (registered.length === 0) return

    const bridgeSource = resolveMainWorldBridgeSourcePath()
    if (!bridgeSource) return

    compiler.options.entry = {
      ...compiler.options.entry,
      [MAIN_WORLD_BRIDGE_ENTRY]: {
        import: [bridgeSource],
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
      }
    }

    // A production file that resolves nothing against the base goes
    // unpaired. Development pairs every file, as a declared group does.
    const shipped = compiler.options?.mode === 'production'
    const readers = getBaseReaderRequirements(compiler)
    const bridgeFile = `${MAIN_WORLD_BRIDGE_ENTRY}.js`
    // The registry is one per extension and the wrapper one per realm, so
    // a page that registers or injects carries the wrapper as well.
    const pages = findBridgePairingPages(this.pageList, projectPath)
    // Development bridges an injection of any compiled entry, no other file.
    const entryFiles = registered.map(({entryName}) => `${entryName}.js`)

    compiler.hooks.thisCompilation.tap(
      PairRuntimeMainWorldBridges.name,
      (compilation) => {
        const readsBase = new Set<string>()

        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          PairRuntimeMainWorldBridges.name,
          (chunk, set) => {
            if (!chunk.name) return

            for (const requirement of set) {
              if (readers.has(String(requirement))) {
                readsBase.add(chunk.name)

                return
              }
            }
          }
        )

        compilation.hooks.processAssets.tap(
          {
            name: PairRuntimeMainWorldBridges.name,
            // After minification, so the prepended text ships as written.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            const baseReaders = shipped
              ? registered
                  .filter(({entryName}) => readsBase.has(entryName))
                  .map(({entryName}) => `${entryName}.js`)
              : null

            if (baseReaders && baseReaders.length === 0) {
              for (const name of [bridgeFile, `${bridgeFile}.map`]) {
                if (compilation.getAsset(name)) compilation.deleteAsset(name)
              }

              return
            }

            const pageAssets = new Set(
              pages.flatMap((page) => pageBundleNames(compilation, page))
            )

            for (const asset of compilation.getAssets()) {
              const onPage = pageAssets.has(asset.name)
              if (!onPage && !BACKGROUND_ASSET.test(asset.name)) continue

              const original = asset.source.source().toString()
              if (original.includes(MAIN_WORLD_BRIDGE_PAIRING_MARK)) continue

              // Firefox resolves a relative js path against the calling
              // page, so a page names the bridge from the extension root.
              prependToEmittedAsset(
                compilation,
                asset,
                `${buildMainWorldBridgePairingSource(
                  onPage ? `/${bridgeFile}` : bridgeFile,
                  baseReaders,
                  baseReaders || entryFiles
                )}\n`
              )
            }
          }
        )
      }
    )
  }
}
