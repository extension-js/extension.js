import path from 'path'
import type webpack from 'webpack'
import {type WebResourcesPluginInterface} from './types'
import CopyStaticFolder from './src/steps/CopyStaticFolder'
// import AutoParseWebResourcesFolder from './src/steps/AutoParseWebResourcesFolder'
import ApplyCommonFileLoaders from './src/steps/ApplyCommonFileLoaders'
import UpdateManifest from './src/steps/UpdateManifest'

export default class WebResourcesPlugin {
  private readonly manifestPath: string
  private readonly exclude?: string[]

  constructor(options: WebResourcesPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  /**
   * WebResourcesPlugin is responsible for handling all assets
   * declared in:
   *
   * - web_accessible_resources paths in the manifest.json file.
   * - Assets imported from content_scripts.
   *
   * and outputting them in the web_accessible_resources folder.
   *
   * Assets supported:
   * - Images: png|jpg|jpeg|gif|webp|avif|ico|bmp|svg
   * - Text: txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz
   * - Fonts: woff|woff2|eot|ttf|otf
   * - CSV: csv|tsv
   * - XML: xml
   *
   * For MV2, the assets are outputted to the web_accessible_resources
   * folder. For MV3, the assets are outputted to web_accessible_resources/resource-[index].
   * These entries are also added to the manifest.json file.
   */
  apply(compiler: webpack.Compiler) {
    const projectPath = path.dirname(this.manifestPath)
    const staticDir = path.join(
      compiler.options.context || projectPath,
      'public/'
    )

    // Copy the static folder recursively, keeping the original
    // folder structure.
    new CopyStaticFolder({staticDir}).apply(compiler)

    // Iterate over the list of web_accessible_resources
    // defined in the manifest.json file and output them
    // to the web_accessible_resources folder.
    // TODO: cezaraugusto this needs more testing.
    // new AutoParseWebResourcesFolder({
    //   manifestPath: this.manifestPath,
    //   exclude: this.exclude
    // }).apply(compiler)

    // 2 - Apply common loaders to handle assets
    // imported from content_scripts and output them
    // in the web_accessible_resources folder.
    new ApplyCommonFileLoaders({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)

    // 3 - Write the web_accessible_resources folder to the manifest allowlist.
    new UpdateManifest({
      manifestPath: this.manifestPath
    }).apply(compiler)
  }
}
