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
import type {FilepathList, PluginInterface} from '../../../types'
import {
  buildMainWorldCopyRoutingSource,
  MAIN_WORLD_COPY_ROUTING_MARK
} from '../scripts-lib/main-world-copy-routing'
import {
  findBridgePairingPages,
  findRuntimeMainWorldEntries
} from '../scripts-lib/runtime-main-world-scripts'
import {
  BACKGROUND_ASSET,
  pageBundleNames
} from './pair-runtime-main-world-bridges'

// A file both worlds run is built once for each, and the calls that name it
// are routed as they are made, in the background and in each page that calls.
export class RouteMainWorldCopies {
  public static readonly name: string = 'scripts:route-main-world-copies'

  private readonly manifestPath: string
  private readonly includeList: FilepathList
  private readonly pageList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.pageList = options.pageList
  }

  public apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return

    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    const copies: Record<string, string> = {}

    for (const {entryName, copyOf} of findRuntimeMainWorldEntries({
      includeList: this.includeList,
      pageList: this.pageList,
      manifestDir,
      projectPath
    })) {
      if (copyOf) copies[`${copyOf}.js`] = `${entryName}.js`
    }

    if (Object.keys(copies).length === 0) return

    const routing = `${buildMainWorldCopyRoutingSource(copies)}\n`
    const pages = findBridgePairingPages(this.pageList, projectPath)

    compiler.hooks.thisCompilation.tap(
      RouteMainWorldCopies.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: RouteMainWorldCopies.name,
            // Ahead of the bridge pairing, whose text then runs first and
            // so is handed the names this routing already settled.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 50
          },
          () => {
            const pageAssets = new Set(
              pages.flatMap((page) => pageBundleNames(compilation, page))
            )

            for (const asset of compilation.getAssets()) {
              if (
                !pageAssets.has(asset.name) &&
                !BACKGROUND_ASSET.test(asset.name)
              ) {
                continue
              }

              const original = asset.source.source().toString()
              if (original.includes(MAIN_WORLD_COPY_ROUTING_MARK)) continue

              prependToEmittedAsset(compilation, asset, routing)
            }
          }
        )
      }
    )
  }
}
