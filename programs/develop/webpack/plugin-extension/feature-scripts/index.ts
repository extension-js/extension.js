import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {AddScripts} from './steps/add-scripts'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {SetupReloadStrategy} from './steps/setup-reload-strategy'
import {AddCentralizedLoggerScript} from './steps/add-centralized-logger-script'
import {type DevOptions} from '../../../develop-lib/config-types'

/**
 * ScriptsPlugin handles JavaScript and CSS entries declared in manifest.json.
 * It also supports extra scripts defined via include. These extra scripts are
 * added to the compilation and are HMR-enabled. They are useful for adding
 * extra scripts to the extension runtime, for example via the scripting API.
 * This plugin also configures the reload strategy for content scripts and
 * background scripts (via webpack-target-webextension) and injects minimal
 * HMR code where applicable.
 *
 * Features supported:
 * - content_scripts.js: HMR enabled
 * - content_scripts.css: HMR enabled
 * - background.scripts: HMR enabled
 * - background.service_worker: reloaded externally by the browser plugin
 * - user_scripts.api_scripts: HMR enabled
 * - include scripts: HMR enabled
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
    const hasValidManifest =
      !!this.manifestPath &&
      fs.existsSync(this.manifestPath) &&
      fs.lstatSync(this.manifestPath).isFile()

    if (!hasValidManifest) {
      return
    }

    // 1 - Adds the scripts entries from the manifest file
    // and from the extra scripts defined in this.include
    // to the compilation.
    new AddScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      excludeList: this.excludeList || {}
    }).apply(compiler)

    // 2 - Add the public path runtime module (all modes)
    // Guard for tests that pass a partial compiler without webpack internals
    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    if (compiler.options.mode !== 'production') {
      // 3 - Apply reload strategy and background setup (development only)
      new SetupReloadStrategy({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)

      // 4 - Inject centralized logger (development only)
      new AddCentralizedLoggerScript({
        manifestPath: this.manifestPath,
        includeList: this.includeList || {},
        excludeList: this.excludeList || {},
        browser: this.browser
      }).apply(compiler)
    }
  }
}
