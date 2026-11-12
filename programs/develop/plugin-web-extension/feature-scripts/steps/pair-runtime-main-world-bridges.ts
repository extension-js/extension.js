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
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'
import {resolveMainWorldBridgeSourcePath} from './add-content-script-wrapper/get-bridge-scripts'

const BACKGROUND_ASSET =
  /(^|\/)background\/(?:service_worker|scripts?|index)\.js$/i

// A declared MAIN world group ships with a bridge that publishes the
// extension base. A runtime registration gets the same pair on Gecko.
export class PairRuntimeMainWorldBridges {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    // A Chromium MAIN bundle reads the base off its own stack.
    if (!isGeckoBasedBrowser(String(this.browser))) return

    const manifestDir = path.dirname(this.manifestPath)
    const registered = findRuntimeMainWorldEntries({
      includeList: this.includeList,
      manifestDir,
      projectPath: (compiler.options.context as string) || manifestDir
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

    compiler.hooks.thisCompilation.tap(
      PairRuntimeMainWorldBridges.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: PairRuntimeMainWorldBridges.name,
            // After minification, so the prepended text ships as written.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!BACKGROUND_ASSET.test(asset.name)) continue

              const original = asset.source.source().toString()
              if (original.includes(MAIN_WORLD_BRIDGE_PAIRING_MARK)) continue

              prependToEmittedAsset(
                compilation,
                asset,
                `${buildMainWorldBridgePairingSource()}\n`
              )
            }
          }
        )
      }
    )
  }
}
