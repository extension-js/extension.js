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
import {AddContentScriptWrapper} from './steps/add-content-script-wrapper'
import {KeepGetURLImportsNative} from './steps/keep-geturl-imports-native'
import {TraceRuntimeLoadedFiles} from './steps/trace-runtime-loaded-files'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {ValidateContentScriptSyntax} from './steps/validate-content-script-syntax'
import type {FilepathList, PluginInterface, DevOptions} from '../../types'

/**
 * Feature-scripts is the official scripts pipeline:
 * - content scripts use the inline lifecycle runtime only
 * - targeted reinjection stays browser-owned
 * - background/manifest changes stay on the full-reload path
 *
 * The dev-only reload/HMR strategy is NOT part of this feature — it lives
 * in plugin-reload, which registers after this plugin and decorates the
 * entries AddScripts declares here.
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

    // Runtime-loaded files the module graph cannot see: classic worker
    // importScripts(...) dependencies and executeScript/insertCSS `files`
    // payloads. Copied through verbatim; missing references become warnings.
    new TraceRuntimeLoadedFiles({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // import(chrome.runtime.getURL(...)) resolves to an absolute
    // chrome-extension:// URL at runtime — no module map can satisfy it, so
    // the call must stay a NATIVE import() in the emitted bundle (the trace
    // step above guarantees the target files ship).
    new KeepGetURLImportsNative({
      manifestPath: this.manifestPath
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

    // swc tolerates some early syntax errors (top-level redeclarations) and
    // emits them into the bundle; the browser then silently never injects the
    // file. Fail loudly instead — in every mode.
    new ValidateContentScriptSyntax().apply(compiler)
  }
}
