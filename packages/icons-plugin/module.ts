import webpack from 'webpack'
import {type IconsPluginInterface} from './types'
import EmitFile from './steps/EmitFile'
import AddToFileDependencies from './steps/AddToFileDependencies'

export default class ScriptsPlugin {
  private readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: IconsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

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
  public apply(compiler: webpack.Compiler): void {
    new EmitFile({
      manifestPath: this.manifestPath,
      exclude: this.exclude || []
    }).apply(compiler)

    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      exclude: this.exclude || []
    }).apply(compiler)
  }
}
