// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler, DefinePlugin} from '@rspack/core'
import {prependToEmittedAsset} from '../../../lib/asset-source-maps'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {extensionSchemeFor} from '../../../lib/extension-base-from-stack'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {getCanonicalContentScriptEntryName} from '../contracts'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'
import {
  closeTakeBlock,
  extensionBaseAttributeFor,
  extensionBaseGlobalFor,
  isEntryFile,
  takesExtensionBase
} from '../scripts-lib/taken-extension-base'
import {getMainWorldBridgePairs} from './add-content-script-wrapper/get-bridge-scripts'

const HOT_UPDATE = /\.hot-update\./i

function parsesAsScript(text: string): boolean {
  try {
    // eslint-disable-next-line no-new-func
    new Function(text)

    return true
  } catch {
    return false
  }
}

// On Firefox the bridge answers the extension base to the first statement
// of a MAIN world file, so each such file opens on the read that takes it.
export class TakeExtensionBase {
  public static readonly name: string = 'scripts:take-extension-base'

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
    const gecko = isGeckoBasedBrowser(String(this.browser))

    // Two extensions share one document on every engine, so each bridge
    // writes the base under its own name and takes its own scheme only.
    if (compiler?.hooks?.compilation) {
      new DefinePlugin({
        __EXTJS_PAGE_BASE_ATTRIBUTE__: JSON.stringify(
          extensionBaseAttributeFor(this.manifestPath, this.browser)
        ),
        __EXTJS_EXTENSION_SCHEME__: JSON.stringify(
          extensionSchemeFor(String(this.browser))
        )
      }).apply(compiler)
    }

    // Chromium names the extension on a MAIN world stack and Safari has no
    // page window to publish on, so their files ship as they were built.
    if (!gecko) return
    if (!compiler?.hooks?.thisCompilation?.tap) return

    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    // A session picks each file's world as it starts, as its wrapper does.
    const entries = [
      ...getMainWorldBridgePairs(this.manifestPath, this.browser).map(
        ({mainIndex}) => getCanonicalContentScriptEntryName(mainIndex)
      ),
      ...findRuntimeMainWorldEntries({
        includeList: this.includeList,
        pageList: this.pageList,
        manifestDir,
        projectPath
      }).map(({entryName}) => entryName)
    ]
    if (entries.length === 0) return

    // The bridge publishes under the name its files read, one per extension.
    const global = extensionBaseGlobalFor(this.manifestPath, this.browser)

    if (compiler.hooks.compilation) {
      new DefinePlugin({
        __EXTJS_PAGE_BASE_GLOBAL__: JSON.stringify(global)
      }).apply(compiler)
    }

    compiler.hooks.thisCompilation.tap(
      TakeExtensionBase.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: TakeExtensionBase.name,
            // After the completion value block, so the read stays first.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 200
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (HOT_UPDATE.test(asset.name)) continue

              if (!entries.some((entry) => isEntryFile(asset.name, entry))) {
                continue
              }

              const text = asset.source.source().toString()
              if (takesExtensionBase(text)) continue

              const {open, closed} = closeTakeBlock(text, global)
              // A module file cannot sit in a block, so it stays as built.
              if (!parsesAsScript(`${open}${closed}`)) continue

              prependToEmittedAsset(
                compilation,
                {name: asset.name, source: {source: () => closed}},
                open
              )
            }
          }
        )
      }
    )
  }
}
