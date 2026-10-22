// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {isWebkitBasedBrowser} from '../../../lib/constants'

export const UTF8_BOM = '﻿'

const SCRIPT_ASSET = /\.[cm]?js$/i

export class StampWebkitUtf8Bom {
  private readonly browser: string

  constructor(options: {browser?: string}) {
    this.browser = String(options.browser || 'chrome')
  }

  apply(compiler: Compiler): void {
    if (!isWebkitBasedBrowser(this.browser)) return
    if (!compiler?.hooks?.thisCompilation?.tap) return

    compiler.hooks.thisCompilation.tap(
      'scripts:stamp-webkit-utf8-bom',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:stamp-webkit-utf8-bom',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 900
          },
          () => {
            const assets =
              typeof compilation.getAssets === 'function'
                ? compilation.getAssets()
                : []

            for (const asset of assets) {
              const name = asset?.name || ''
              if (!SCRIPT_ASSET.test(name)) continue

              let source = ''

              try {
                source = asset.source?.source?.().toString() || ''
              } catch {
                continue
              }

              if (!source || source.charCodeAt(0) === 0xfeff) continue

              compilation.updateAsset(
                name,
                new sources.RawSource(`${UTF8_BOM}${source}`)
              )
            }
          }
        )
      }
    )
  }
}
