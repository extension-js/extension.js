import {type Compiler} from 'webpack'
import {CopyPublicFolder} from './copy-public-folder'
import {WarnUponFolderChanges} from './warn-upon-folder-changes'

interface SpecialFoldersPluginOptions {
  manifestPath: string
}

/**
 * SpecialFoldersPlugin is responsible for handling the
 * three types of special folders in the extension:
 *
 * - /pages - HTML pages not included in the manifest
 * - /scripts - Script files not included in the manifest
 * - /public - Static files not included in the manifest
 */
export class SpecialFoldersPlugin {
  private readonly options: SpecialFoldersPluginOptions

  constructor(options: SpecialFoldersPluginOptions) {
    this.options = options
  }

  apply(compiler: Compiler) {
    const {manifestPath} = this.options

    new CopyPublicFolder({
      manifestPath
    }).apply(compiler)

    if (compiler.options.mode === 'development') {
      if (compiler.options.watchOptions) {
        new WarnUponFolderChanges(manifestPath).apply(compiler)
      }
    }
  }
}
