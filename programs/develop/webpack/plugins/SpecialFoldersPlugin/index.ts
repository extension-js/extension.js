import {Compiler} from 'webpack'
import CopyPublicFolder from './CopyPublicFolder'
import WarnUponFolderChanges from './WarnUponFolderChanges'

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
export default class SpecialFoldersPlugin {
  private readonly options: SpecialFoldersPluginOptions

  constructor(options: SpecialFoldersPluginOptions) {
    this.options = options
  }

  apply(compiler: Compiler) {
    const {manifestPath} = this.options

    new CopyPublicFolder({
      manifestPath
    }).apply(compiler)

    if (compiler.options.watch) {
      new WarnUponFolderChanges(manifestPath).apply(compiler)
    }
  }
}
