import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {AddScripts} from './steps/add-scripts'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {AddPublicPathForMainWorld} from './steps/add-public-path-for-main-world'
import {type DevOptions} from '../../../module'

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
  public readonly browser?: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    // 1 - Adds the scripts entries from the manifest file
    // and from the extra scripts defined in this.include
    // to the compilation.
    new AddScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      excludeList: this.excludeList || {}
    }).apply(compiler)

    // 2 - Apply content script wrapper for shadow DOM and auto-execution (all modes)
    compiler.options.module.rules.push({
      test: /(\.m?[jt]sx?)$/,
      include: [path.dirname(this.manifestPath)],
      exclude: [/[/\\]node_modules[/\\]/],
      use: [
        {
          loader: path.resolve(__dirname, 'add-content-script-wrapper'),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode,
            includeList: this.includeList || {},
            excludeList: this.excludeList || {}
          }
        }
      ]
    })

    // 3 - Ensure scripts are HMR enabled by adding the HMR accept code. (development only)
    if ((compiler.options.mode || 'development') !== 'production') {
      // 3a - Warn users if they still have import.meta.*hot in their sources (backwards compatibility)
      // Only apply warn-import-meta loader if its compiled artifact exists
      try {
        const warnLoaderBase = path.resolve(
          __dirname,
          'steps',
          'warn-import-meta'
        )
        const warnLoaderPath =
          fs.existsSync(warnLoaderBase + '.js') || fs.existsSync(warnLoaderBase)
            ? warnLoaderBase
            : null
        if (warnLoaderPath) {
          compiler.options.module.rules.push({
            test: /(\.m?[jt]sx?)$/,
            include: [path.dirname(this.manifestPath)],
            exclude: [/[/\\]node_modules[/\\]/],
            use: [
              {
                loader: warnLoaderPath,
                options: {
                  manifestPath: this.manifestPath
                }
              }
            ]
          })
        }
      } catch {}

      compiler.options.module.rules.push({
        test: /(\.m?[jt]sx?)$/,
        include: [path.dirname(this.manifestPath)],
        exclude: [/[/\\]node_modules[/\\]/],
        use: [
          {
            loader: path.resolve(__dirname, 'add-hmr-accept-code'),
            options: {
              manifestPath: this.manifestPath,
              mode: compiler.options.mode,
              includeList: this.includeList || {},
              excludeList: this.excludeList || {}
            }
          }
        ]
      })
    }

    // 4 - Fix the issue with the public path not being
    // available for content_scripts in the production build.
    // See https://github.com/cezaraugusto/extension.js/issues/95
    // See https://github.com/cezaraugusto/extension.js/issues/96
    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    // 5 - Fix the issue where assets imported via content_scripts
    // running in the MAIN world could not find the correct public path.
    new AddPublicPathForMainWorld({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome',
      includeList: this.includeList || {},
      excludeList: this.excludeList || {}
    }).apply(compiler)

    // 6 - Deprecate the use of window.__EXTENSION_SHADOW_ROOT__ (development only)
    if ((compiler.options.mode || 'development') !== 'production') {
      compiler.options.module.rules.push({
        test: /(\.m?[jt]sx?)$/,
        include: [path.dirname(this.manifestPath)],
        exclude: [/[/\\]node_modules[/\\]/],
        use: [
          {
            loader: path.resolve(__dirname, 'deprecated-shadow-root'),
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
