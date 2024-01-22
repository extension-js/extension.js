import webpack from 'webpack'

import {type ScriptsPluginInterface} from './types'
import AddScriptsAndStyles from './src/steps/AddScriptsAndStyles'
import AddHmrAcceptCode from './src/steps/AddHmrAcceptCode'
import AddDynamicCssImport from './src/steps/AddDynamicCssImport'

export default class HtmlPlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: ScriptsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
  }

  /**
   * Scripts plugin is responsible for handiling all the JavaScript
   * (and CSS, for content_scripts) possible fields in manifest.json.
   *
   * Features supported:
   * - content_scripts.js - HMR enabled
   * - content_scripts.css - HMR enabled
   * - background.scripts - HMR enabled
   * - service_worker - Reloaded by chrome.runtime.reload()
   * - user_scripts.api_scripts - HMR enabled
   *
   * The background (and service_worker) scripts are also
   * responsible for receiving messages from the extension
   * reload plugin. They are responsible for reloading the
   * extension runtime when a change is detected in the
   * manifest.json file and in the service_worker.
   */
  public apply(compiler: webpack.Compiler): void {
    // 1 - Adds the scripts entries from the manifest file
    // (and stylesheets for content_scripts) to the compilation.
    new AddScriptsAndStyles({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)

    // 2 - Ensure scripts (content, background, service_worker)
    // are HMR enabled by adding the reload code.
    AddHmrAcceptCode(compiler, this.manifestPath)

    // 3 - Ensure css for content_scripts defined in manifest.json
    // are HMR enabled by adding them as dynamic imports to the entry point.
    AddDynamicCssImport(compiler, this.manifestPath)
  }
}
