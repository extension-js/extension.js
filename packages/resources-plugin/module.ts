import type webpack from 'webpack'
import {type WebResourcesPluginInterface} from './types'
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
   * ResourcesPlugin is responsible for requires of all static assets
   * in web_accessible_resources and in the extension script files,
   * with a special case for content_scripts. It also copies the
   * 'public/' folder to the output directory.
   *
   * Feature supported:
   *
   * - web_accessible_resources paths in the manifest.json file.
   * - Assets imported from content_scripts files.
   * - Assets imported from other script files.
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
    // 0 - Iterate over the list of web_accessible_resources
    // defined in the manifest.json file and output them
    // to the web_accessible_resources folder.
    // TODO: cezaraugusto this needs more testing.
    // new AutoParseWebResourcesFolder({
    //   manifestPath: this.manifestPath,
    //   exclude: this.exclude
    // }).apply(compiler)

    // 1 - Apply common loaders to handle assets
    // imported from content_scripts and output them
    // in the web_accessible_resources folder.
    new ApplyCommonFileLoaders({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)

    // 2 - Write the web_accessible_resources folder to the manifest allowlist.
    new UpdateManifest({
      manifestPath: this.manifestPath
    }).apply(compiler)
  }
}
