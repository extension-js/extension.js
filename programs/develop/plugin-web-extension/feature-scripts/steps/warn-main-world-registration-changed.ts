// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {type Compiler, WebpackError} from '@rspack/core'
import type {FilepathList, PluginInterface} from '../../../types'
import {unixify} from '../../shared/paths'
import * as messages from '../messages'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'

// The steps that build a MAIN world file take their list once, when the
// compiler is made, so a call written mid-session needs a new session.
export class WarnMainWorldRegistrationChanged {
  public static readonly name: string =
    'scripts:warn-main-world-registration-changed'

  private readonly manifestPath: string
  private readonly includeList: FilepathList
  private readonly pageList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.pageList = options.pageList
  }

  public apply(compiler: Compiler): void {
    if (compiler.options.mode !== 'development') return
    if (!compiler?.hooks?.thisCompilation?.tap) return

    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    const find = () =>
      findRuntimeMainWorldEntries({
        includeList: this.includeList,
        pageList: this.pageList,
        manifestDir,
        projectPath
      })
    const relative = (file: string) => unixify(path.relative(projectPath, file))
    // The same answer the build steps took as this compiler was made.
    const atStart = new Map(
      find().map((entry) => [entry.entryName, entry.files])
    )

    compiler.hooks.thisCompilation.tap(
      WarnMainWorldRegistrationChanged.name,
      (compilation) => {
        // Read on every compilation, so a call taken back stops warning.
        const now = new Map(find().map((entry) => [entry.entryName, entry]))
        const changed: Array<{files: string[]; registeredBy?: string}> = []

        for (const [entryName, entry] of now) {
          if (!atStart.has(entryName)) changed.push(entry)
        }

        for (const [entryName, files] of atStart) {
          if (!now.has(entryName)) changed.push({files})
        }

        for (const {files, registeredBy} of changed) {
          const scriptPath = relative(files[0])
          const warning = new WebpackError(
            messages.mainWorldRegistrationChanged(
              scriptPath,
              registeredBy ? relative(registeredBy) : undefined
            )
          ) as Error & {name?: string; file?: string}
          warning.name = 'MainWorldRegistrationChange'
          warning.file = registeredBy ? relative(registeredBy) : scriptPath
          compilation.warnings.push(warning)
        }
      }
    )
  }
}
