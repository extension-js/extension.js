import fs from 'fs'
import {type Compiler} from 'webpack'
import {type ManifestCompatInterface} from './types'
import handleSchemaErrors from './handleSchemaErrors'
import handleRuntimeErrors from './handleRuntimeErrors'
import {type ManifestBase} from './manifest-types'

export default class ManifestCompatPlugin {
  private readonly options: ManifestCompatInterface

  constructor(options: ManifestCompatInterface) {
    this.options = options
  }

  apply(compiler: Compiler) {
    compiler.hooks.afterCompile.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        const manifestPath = this.options.manifestPath
        const manifest: ManifestBase = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        )
        const browser = this.options.browser || 'chrome'

        handleSchemaErrors(compilation, manifest, browser)
        handleRuntimeErrors(compilation, manifest, browser)

        done()
      }
    )
  }
}
