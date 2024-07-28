import path from 'path'
import type webpack from 'webpack'
import {type FilepathList, type PluginInterface} from '../../types'
import {AddScripts} from './steps/add-scripts'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'

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
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
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

    // In production: Adds the CSS files to the entry points
    // along with other content_script files.
    // In development: Extracts the content_scripts css files
    // from content_scripts and injects them as dynamic imports
    // so we can benefit from HMR.
    if (compiler.options.mode === 'development') {
      compiler.options.module.rules.push({
        test: /\.(m?js|m?ts)x?$/,
        use: [
          {
            loader: require.resolve(
              path.join(__dirname, 'inject-content-css-during-dev.js')
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

    // 2 - Ensure scripts are HMR enabled by adding the HMR accept code.
    if (compiler.options.mode === 'development') {
      compiler.options.module.rules.push({
        test: /\.(m?js|m?ts)x?$/,
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
    // compiler.options.module.rules.push({
    //   test: /\.(m?js|m?ts)x?$/,
    //   use: [
    //     {
    //       loader: path.resolve(__dirname, './add-dynamic-public-path.js'),
    //       options: {
    //         manifestPath: this.manifestPath,
    //         includeList: this.includeList || {},
    //         excludeList: this.excludeList || {},
    //       },
    //     },
    //   ],
    // });

    // 5 - Fix the issue of content_scripts not being able to import
    // CSS files via import statements. This loader adds the
    // is_content_css_import=true query param to CSS imports in
    // content_scripts. This skips the MiniCssExtractPlugin loader
    // and allows the CSS to be injected in the DOM via <style> tags.
    if (compiler.options.mode === 'development') {
      compiler.options.module.rules.push({
        test: /\.(m?js|m?ts)x?$/,
        use: [
          {
            loader: path.resolve(
              __dirname,
              './add-query-param-to-imported-css.js'
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
  }
}
