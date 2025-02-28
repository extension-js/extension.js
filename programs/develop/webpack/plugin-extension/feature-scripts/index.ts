import path from 'path'
import type webpack from 'webpack'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {AddScripts} from './steps/add-scripts'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {AddPublicPathForMainWorld} from './steps/add-public-path-for-main-world'
import {DevOptions} from '../../../module'

/**
 * ScriptsPlugin is responsible for handiling all possible JavaScript
 * (and CSS, for content_scripts) fields in manifest.json. It also
 * supports extra scripts defined via this.include option. These
 * extra scripts are added to the compilation and are also HMR
 * enabled. They are useful for adding extra scripts to the
 * extension runtime, like content_scripts via `scripting`, for example.
 *
 * Features supported:
 * - content_scripts.js - HMR enabled
 * - content_scripts.css - HMR enabled
 * - background.scripts - HMR enabled
 * - service_worker - Reloaded by chrome.runtime.reload()
 * - user_scripts.api_scripts - HMR enabled
 * - scripts via this.include - HMR enabled
 */
export class ScriptsPlugin {
  public readonly manifestPath: string
  public readonly browser?: DevOptions['browser']
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: webpack.Compiler): void {
    // 1 - Adds the scripts entries from the manifest file
    // and from the extra scripts defined in this.include
    // to the compilation.
    new AddScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      excludeList: this.excludeList || {}
    }).apply(compiler)

    // 2 - Ensure scripts are HMR enabled by adding the HMR accept code.
    if (compiler.options.mode === 'development') {
      compiler.options.module.rules.push({
        test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: [path.dirname(this.manifestPath)],
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve(
              path.join(__dirname, 'add-hmr-accept-code.js')
            ),
            options: {
              manifestPath: this.manifestPath,
              includeList: this.includeList || {},
              excludeList: this.excludeList || {}
            }
          }
        ]
      })
    }

    // 3 - Fix the issue with the public path not being
    // available for content_scripts in the production build.
    // See https://github.com/cezaraugusto/extension.js/issues/95
    // See https://github.com/cezaraugusto/extension.js/issues/96
    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    // 4 - Fix the issue where assets imported via content_scripts
    // running in the MAIN world could not find the correct public path.
    new AddPublicPathForMainWorld({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome',
      includeList: this.includeList || {},
      excludeList: this.excludeList || {}
    }).apply(compiler)
  }
}
