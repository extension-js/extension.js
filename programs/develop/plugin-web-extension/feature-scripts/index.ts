// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import {AddContentScriptWrapper} from './steps/add-content-script-wrapper'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {AddScripts} from './steps/add-scripts'
import {KeepGetURLImportsNative} from './steps/keep-geturl-imports-native'
import {TraceRuntimeLoadedFiles} from './steps/trace-runtime-loaded-files'
import {ValidateContentScriptSyntax} from './steps/validate-content-script-syntax'

/**
 * Feature-scripts is the official scripts pipeline:
 * - content scripts use the inline lifecycle runtime only
 * - targeted reinjection stays browser-owned
 * - background/manifest changes stay on the full-reload path
 *
 * The dev-only reload/HMR strategy is NOT part of this feature. It lives
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
      includeList: this.includeList || {},
      browser: this.browser
    }).apply(compiler)

    // Runtime-loaded files the module graph cannot see (importScripts, executeScript
    // files payloads): copied through verbatim, missing references warn.
    new TraceRuntimeLoadedFiles({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // import(chrome.runtime.getURL(...)) resolves at runtime; no module map can
    // satisfy it, so the call must stay a NATIVE import() in the emitted bundle.
    new KeepGetURLImportsNative({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // The wrapper is load-bearing in every mode: it emits the __EXTENSIONJS_mount
    // call; without it rspack tree-shakes the entire entry body in production.
    new AddContentScriptWrapper({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule().apply(compiler)
    }

    // swc tolerates some early syntax errors and emits them into the bundle; the
    // browser then silently never injects the file. Fail loudly in every mode.
    new ValidateContentScriptSyntax().apply(compiler)
  }
}
