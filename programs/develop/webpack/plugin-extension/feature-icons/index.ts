import {type Compiler} from '@rspack/core'
import {EmitFile} from './steps/emit-file'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {
  ThemeIcon,
  type FilepathList,
  type PluginInterface
} from '../../webpack-types'

/**
 * IconsPlugin is responsible for handling the icon files defined
 * in the manifest.json. It emits the icon files to the output
 * directory and adds them to the file dependencies of the compilation.
 *
 * Features supported:
 * action.default_icon
 * browser_action.default_icon
 * icons
 * page_action.default_icon
 * sidebar_action.default_icon
 */
export class IconsPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList | {[x: string]: ThemeIcon}
  public readonly excludeList?: FilepathList | {[x: string]: ThemeIcon}

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }
  public apply(compiler: Compiler): void {
    new EmitFile({
      manifestPath: this.manifestPath,
      includeList: this.includeList as FilepathList,
      excludeList: this.excludeList as FilepathList
    }).apply(compiler)

    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList: this.includeList as FilepathList,
      excludeList: this.excludeList as FilepathList
    }).apply(compiler)
  }
}
