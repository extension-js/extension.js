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
import {SetupReloadStrategy} from './steps/setup-reload-strategy'
import {AddContentScriptWrapper} from './steps/setup-reload-strategy/add-content-script-wrapper'
import {StripContentScriptDevServerRuntime} from './steps/strip-content-script-dev-server-runtime'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {ThrowIfManifestScriptsChange} from './steps/throw-if-manifest-scripts-change'
import type {
  FilepathList,
  PluginInterface,
  DevOptions
} from '../../webpack-types'

/**
 * Feature-scripts is the official scripts pipeline:
 * - content scripts use the inline lifecycle runtime only
 * - targeted reinjection stays browser-owned
 * - background/manifest changes stay on the full-reload path
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

    new AddScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {}
    }).apply(compiler)

    new AddContentScriptWrapper({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    if (compiler.options.mode !== 'production') {
      new StripContentScriptDevServerRuntime().apply(compiler)

      new SetupReloadStrategy({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)

      new ThrowIfManifestScriptsChange({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)
    }
  }
}
