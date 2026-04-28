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
import type {FilepathList, PluginInterface, DevOptions} from '../../types'

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

    // The content-script wrapper is load-bearing in every mode: it converts
    // `export default fn` into `__EXTENSIONJS_default__` and emits the
    // `__EXTENSIONJS_mount(__EXTENSIONJS_default__, runAt)` call that
    // actually invokes the user's default export. Without it, rspack treats
    // the entry chunk as a side-effect-free module that exports an unused
    // default, and tree-shakes the entire body out of the production bundle.
    // EXTENSION_NO_RELOAD opts out of the reload strategy below, not the
    // wrapper itself — the mount call has to run in every build mode.
    new AddContentScriptWrapper({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    if (
      compiler.options.mode !== 'production' &&
      process.env.EXTENSION_NO_RELOAD !== 'true'
    ) {
      new StripContentScriptDevServerRuntime().apply(compiler)

      new SetupReloadStrategy({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)
    }
  }
}
