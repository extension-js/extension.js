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

    // The content-script wrapper exists to drive in-place reinjection on
    // rebuild. It threads __EXTENSIONJS_DEV_REINJECT__ registry plumbing,
    // generation tracking, and data-extjs-reinject-* attributes into every
    // content-script entry — useful in development, dead weight in
    // production. EXTENSION_NO_RELOAD lets `extension dev --no-reload`
    // produce a dev-mode dist without the wrapper for users who want to
    // run the watcher without disrupting an open page.
    const wrapperDisabled =
      compiler.options.mode === 'production' ||
      process.env.EXTENSION_NO_RELOAD === 'true'

    if (!wrapperDisabled) {
      new AddContentScriptWrapper({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)
    }

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
