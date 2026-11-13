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
import {findUnknownWorldRegistrations} from '../scripts-lib/runtime-main-world-scripts'

// A world the call computes is one no build can read, and the file is
// built for the isolated world. The build says so once for each call.
export class WarnUnknownRegistrationWorld {
  public static readonly name: string =
    'scripts:warn-unknown-registration-world'

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

    compiler.hooks.thisCompilation.tap(
      WarnUnknownRegistrationWorld.name,
      (compilation) => {
        // Read on every compilation, so a world written out stops warning.
        const calls = new Map<
          string,
          {sourcePath: string; line: number; emitted: Set<string>}
        >()

        for (const {file, line, emitted} of findUnknownWorldRegistrations({
          includeList: this.includeList,
          pageList: this.pageList,
          manifestDir,
          projectPath
        })) {
          const sourcePath = unixify(path.relative(projectPath, file))
          const key = `${sourcePath}:${line}`
          const call = calls.get(key) || {sourcePath, line, emitted: new Set()}

          call.emitted.add(emitted)
          calls.set(key, call)
        }

        for (const {sourcePath, line, emitted} of calls.values()) {
          const warning = new WebpackError(
            messages.unknownRegistrationWorld(sourcePath, line, [...emitted])
          ) as Error & {name?: string; file?: string}
          warning.name = 'UnknownRegistrationWorld'
          warning.file = sourcePath
          compilation.warnings.push(warning)
        }
      }
    )
  }
}
