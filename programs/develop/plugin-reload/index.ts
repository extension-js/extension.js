// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {SetupReloadStrategy} from './steps/setup-reload-strategy'
import {StripContentScriptDevServerRuntime} from './steps/strip-content-script-dev-server-runtime'
import {InjectScriptsReplayShim} from './steps/inject-scripts-replay-shim'
import {InjectBridgeProducer} from './steps/inject-bridge-producer'
import {InjectBridgeRelay} from './steps/inject-bridge-relay'
import {PruneStaleHotUpdates} from './steps/prune-stale-hot-updates'
import type {PluginInterface, DevOptions} from '../types'

export {
  type ReloadType,
  type ReloadInstruction,
  type SourceFeatureIndex,
  formatReloadContextLabel,
  pageContextFromSources,
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  readContentScriptCount
} from './classify-reload'

export {
  type ChangedSourcesSnapshot,
  type ChangedSourcesTracker,
  createChangedSourcesTracker,
  dispatchReload,
  type ReloadBroker,
  type ReloadExecutor
} from './reload-dispatch'

/**
 * ReloadPlugin owns the dev-only reload/HMR strategy end to end:
 *
 * - build-time injection of the reload runtime (SetupReloadStrategy and the
 *   vendored webpack-target-webextension fork), the SW scripts-replay shim,
 *   and the control-bridge producer/relay instrumentation
 * - the reload classifier and dispatch seam consumed by plugin-browsers'
 *   BrowsersPlugin and the dev server's `--no-browser` broadcast path
 *   (re-exported above from classify-reload.ts / reload-dispatch.ts)
 *
 * Registration order matters: this plugin must be applied AFTER
 * plugin-web-extension — SetupReloadStrategy decorates the background and
 * content-script entries that feature-scripts' AddScripts declares.
 *
 * The whole pipeline is dev-only; `EXTENSION_NO_RELOAD=true` opts out. The
 * every-mode content-script wrapper (mount lifecycle) is NOT part of this
 * plugin — it lives in feature-scripts/steps/add-content-script-wrapper.
 */
export class ReloadPlugin {
  public static readonly name = 'plugin-reload'

  public readonly manifestPath: string
  public readonly browser?: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    if (
      compiler.options.mode === 'production' ||
      process.env.EXTENSION_NO_RELOAD === 'true'
    ) {
      return
    }

    const hasValidManifest =
      !!this.manifestPath &&
      fs.existsSync(this.manifestPath) &&
      fs.lstatSync(this.manifestPath).isFile()

    if (!hasValidManifest) {
      return
    }

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

    // Hot chunks are fetched from the extension origin (disk), so they live
    // in the loadable dist — prune superseded generations so a long editing
    // session doesn't accumulate hundreds of stale files in "what ships".
    new PruneStaleHotUpdates().apply(compiler)
  }
}
