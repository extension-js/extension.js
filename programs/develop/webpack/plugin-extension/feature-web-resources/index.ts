import type webpack from 'webpack'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
// import AddResourcesFromContentScripts from './steps/add-resources-from-content-scripts'
import {UpdateManifest} from './update-manifest'

/**
 * ResourcesPlugin is responsible for adding resources required
 * by the user and the content_scripts to the manifest.json file.
 *
 * Feature supported:
 *
 * - web_accessible_resources paths in the manifest.json file.
 * - Assets imported from content_scripts files.
 */
export class WebResourcesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  apply(compiler: webpack.Compiler) {
    // new AddResourcesFromContentScripts({
    //   manifestPath: this.manifestPath,
    //   includeList: this.includeList,
    //   excludeList: this.excludeList,
    // }).apply(compiler)

    // 2 - Write the web_accessible_resources folder to the manifest allowlist.
    // TODO: IncludeList will return a list of script files.
    // We wait until the ManifestPlugin to generate the reports and get
    // the assets required by them, and then add it to web_accessible_resources
    // in the final manifest.json file.
    new UpdateManifest({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList
    }).apply(compiler)
  }
}
