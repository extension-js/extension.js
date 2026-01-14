// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {AddScripts} from './steps/add-scripts'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {SetupReloadStrategy} from './steps/setup-reload-strategy'
// import {AddCentralizedLoggerScript} from './steps/add-centralized-logger-script'
import {AddContentScriptWrapper} from './steps/setup-reload-strategy/add-content-script-wrapper'
import {ThrowIfManifestScriptsChange} from './steps/throw-if-manifest-scripts-change'
import * as messages from './messages'
import type {
  FilepathList,
  PluginInterface,
  DevOptions
} from '../../webpack-types'

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
  public readonly browser?: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
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

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const featuresCount = Object.keys(this.includeList || {}).length
      console.log(
        messages.scriptsIncludeSummary(
          featuresCount,
          compiler.options.mode !== 'production',
          String(this.browser || 'chrome')
        )
      )
    }

    // 1 - Adds the scripts entries from the manifest file
    // and from the extra scripts defined in this.include
    // to the compilation.
    new AddScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {}
    }).apply(compiler)

    // 2 - Add the content script wrapper.
    // The contract requires the user to export a
    // default function that returns an optional cleanup function.
    new AddContentScriptWrapper({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 3 - Add the public path runtime module (all modes)
    // Guard for tests that pass a partial compiler without webpack internals
    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    if (compiler.options.mode !== 'production') {
      // 4 - Apply reload strategy and background setup (development only)
      new SetupReloadStrategy({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)

      // 5 - Restart-required if manifest script entrypoints changed
      new ThrowIfManifestScriptsChange({
        manifestPath: this.manifestPath,
        includeList: this.includeList || {},
        browser: this.browser
      }).apply(compiler)

      // 6 - Inject centralized logger (development only)
      // TODO: cezaraugusto enable this after v3
      // new AddCentralizedLoggerScript({
      //   manifestPath: this.manifestPath,
      //   includeList: this.includeList || {},
      //   browser: this.browser
      // }).apply(compiler)
    }
  }
}
