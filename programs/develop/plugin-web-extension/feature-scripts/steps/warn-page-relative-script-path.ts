// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {type Compiler, WebpackError} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {unixify} from '../../shared/paths'
import * as messages from '../messages'
import {findPageRelativeScriptPaths} from '../scripts-lib/runtime-main-world-scripts'

// Gecko resolves a path without a leading slash against the calling page
// and reports nothing when the file is missing, so the build names it.
export class WarnPageRelativeScriptPath {
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
    if (!isGeckoBasedBrowser(String(this.browser))) return
    if (!compiler?.hooks?.thisCompilation?.tap) return

    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir

    compiler.hooks.thisCompilation.tap(
      'scripts:warn-page-relative-script-path',
      (compilation) => {
        // Read on every compilation, so a corrected path stops warning.
        const paths = findPageRelativeScriptPaths({
          includeList: this.includeList,
          pageList: this.pageList,
          manifestDir,
          projectPath
        })

        for (const {file, literal, requested, emitted} of paths) {
          const sourcePath = unixify(path.relative(projectPath, file))
          const warning = new WebpackError(
            messages.pageRelativeScriptPath(
              sourcePath,
              literal,
              requested,
              emitted
            )
          ) as Error & {file?: string}
          warning.file = sourcePath
          compilation.warnings.push(warning)
        }
      }
    )
  }
}
