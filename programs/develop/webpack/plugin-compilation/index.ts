import * as fs from 'fs'
import {Compiler} from '@rspack/core'
import CaseSensitivePathsPlugin from 'case-sensitive-paths-webpack-plugin'
import {EnvPlugin} from './env'
// import {CleanDistFolderPlugin} from './clean-dist'
import * as messages from '../lib/messages'
import {type PluginInterface} from '../webpack-types'

export class CompilationPlugin {
  public static readonly name: string = 'plugin-compilation'

  public readonly manifestPath: string
  public readonly browser: PluginInterface['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    // TODO: This is outdated
    new CaseSensitivePathsPlugin().apply(compiler as any)

    new EnvPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // Clear the cleanup plugin for now.
    // This is running at an stage that is earlier
    // than the pulling of remote artifacts,
    // which causes an error. I have no idea whether
    // this will make a difference since we enable
    // "clean" during ddevelopment already.
    // TODO: cezaraugusto keep an eye on this.
    // new CleanDistFolderPlugin().apply(compiler)

    compiler.hooks.done.tapAsync('develop:brand', (stats, done) => {
      stats.compilation.name = undefined

      // Calculate compilation time
      const duration = stats.compilation.endTime! - stats.compilation.startTime!

      const manifestName = JSON.parse(
        fs.readFileSync(this.manifestPath, 'utf-8')
      ).name
      console.log(messages.boring(manifestName, duration, stats))

      done()
    })
  }
}
