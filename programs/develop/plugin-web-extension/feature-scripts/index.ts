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
import {InjectScriptsReplayShim} from './steps/setup-reload-strategy/inject-scripts-replay-shim'
import {InjectBridgeProducer} from './steps/setup-reload-strategy/inject-bridge-producer'
import {InjectBridgeRelay} from './steps/setup-reload-strategy/inject-bridge-relay'
import {StripContentScriptDevServerRuntime} from './steps/strip-content-script-dev-server-runtime'
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

    if (
      compiler.options.mode !== 'production' &&
      process.env.EXTENSION_NO_RELOAD !== 'true'
    ) {
      new StripContentScriptDevServerRuntime().apply(compiler)

      new SetupReloadStrategy({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).apply(compiler)

      // Inject the SW-side `__extjsScriptsReplay` shim so the controller can
      // re-execute previously-issued `chrome.scripting.executeScript` calls
      // after a user edits a file in /scripts/* — bringing programmatic
      // injection HMR closer to parity with declarative content_scripts.
      new InjectScriptsReplayShim().apply(compiler)

      // Inject the agent-bridge producer so the background SW forwards its
      // console output to the dev-server control WS (agent bridge).
      // No-ops when the control bridge is unavailable.
      new InjectBridgeProducer().apply(compiler)

      // Forward content-script console to the SW relay (multi-context logs).
      // No-ops when the control bridge is unavailable.
      new InjectBridgeRelay().apply(compiler)
    }
  }
}
