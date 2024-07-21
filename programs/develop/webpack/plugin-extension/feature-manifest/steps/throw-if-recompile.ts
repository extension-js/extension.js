import webpack from 'webpack'

import * as messages from '../../../lib/messages'
import {type PluginInterface, type FilepathList} from '../../../types'

export class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  private readonly initialValues: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
    this.initialValues = this.includeList || {}
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.watchRun.tapAsync(
      'manifest:throw-if-recompile-is-needed',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        if (files.has(this.manifestPath)) {
          const updatedValues = Object.values(this.includeList || {}).sort()
          const initialValues = Object.values(this.initialValues || {}).sort()

          if (initialValues.toString() !== updatedValues.toString()) {
            compiler.hooks.thisCompilation.tap(
              'ManifestPlugin (ThrowIfRecompileIsNeeded)',
              (compilation) => {
                const errorMessage =
                  messages.serverRestartRequiredFromManifest()
                compilation.errors.push(new webpack.WebpackError(errorMessage))
              }
            )
          }
        }
        done()
      }
    )
  }
}
