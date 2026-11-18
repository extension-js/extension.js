// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import {isChromiumBasedBrowser, isEmulatorBrowser} from '../lib/constants'
import type {DevOptions, PluginInterface} from '../types'
import {
  InjectBridgeProducer,
  readBootRegistrations,
  readDevBuild
} from './steps/inject-bridge-producer'
import {InjectBridgeRelay} from './steps/inject-bridge-relay'
import {InjectScriptsReplayShim} from './steps/inject-scripts-replay-shim'
import {PruneStaleHotUpdates} from './steps/prune-stale-hot-updates'
import {PruneUnreachableChunks} from './steps/prune-unreachable-chunks'
import {SetupDevContentScripts} from './steps/setup-dev-content-scripts'
import {SetupReloadStrategy} from './steps/setup-reload-strategy'
import {StableContentScriptNames} from './steps/stable-content-script-names'
import {StripContentScriptDevServerRuntime} from './steps/strip-content-script-dev-server-runtime'

export {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createLoadedContentScripts,
  type ReloadInstruction,
  type ReloadType,
  readContentScriptCount
} from './classify-reload'
export {
  mergeReloadInstructions,
  reloadSurvivingPackage
} from './reload-after-package'
export {
  type ChangedSourcesTracker,
  createChangedSourcesTracker,
  dispatchReload,
  dispatchRestartReload,
  fullReloadsDeliveredTo,
  type ReloadBroker
} from './reload-dispatch'
export {readBootRegistrations, readDevBuild}

/**
 * ReloadPlugin owns the dev-only reload/HMR strategy end to end:
 *
 * - build-time injection of the reload runtime (SetupReloadStrategy, which
 *   also applies plugin-web-extension's chunk loading target for a dev
 *   session), the SW scripts-replay shim, and the control-bridge
 *   producer/relay instrumentation
 * - the reload classifier, what the browser last read, the trim and merge
 *   a packaged browser needs, and the dispatch seam. plugin-browsers and the
 *   dev server's `--no-browser` path call them (re-exported above)
 *
 * Registration order matters: this plugin must be applied AFTER
 * plugin-web-extension, SetupReloadStrategy decorates the background and
 * content-script entries that feature-scripts' AddScripts declares.
 *
 * The whole pipeline is dev-only; `EXTENSION_NO_RELOAD=true` opts out. The
 * every-mode content-script wrapper (mount lifecycle) is NOT part of this
 * plugin. It lives in feature-scripts/steps/add-content-script-wrapper.
 */
export class ReloadPlugin {
  public static readonly name = 'plugin-reload'

  public readonly manifestPath: string
  public readonly browser?: DevOptions['browser']
  private readonly devSession?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
  }

  public apply(compiler: Compiler): void {
    if (
      compiler.options.mode === 'production' ||
      // A shippable development build carries no reload client.
      this.devSession === false ||
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
    new StableContentScriptNames().apply(compiler)

    new SetupReloadStrategy({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // Inject the SW-side __extjsScriptsReplay shim so the controller can re-run
    // prior scripting.executeScript calls after /scripts/* edits.
    new InjectScriptsReplayShim().apply(compiler)

    // Chromium caches a static content script at load, so the manifest entry
    // becomes a stub and the worker registers the real bundle from a registry.
    // Emulated Chromium keeps the static entry: the registry re-registers
    // through the reload producer this lane never injects, and the emulator
    // swaps a static content script itself on a content-scripts reload.
    // Measured 2026-09-19: with the stub, a content script edit never re-ran
    // on the emulated sample page (standalone proof 24 of 26).
    if (
      isChromiumBasedBrowser(String(this.browser)) &&
      !isEmulatorBrowser(this.browser)
    ) {
      new SetupDevContentScripts().apply(compiler)
    }

    if (!isEmulatorBrowser(this.browser)) {
      // Inject the agent-bridge producer so the background SW forwards console
      // output to the dev-server control WS; no-op when the bridge is unavailable.
      new InjectBridgeProducer().apply(compiler)

      // Forward content-script console to the SW relay (multi-context logs).
      // No-ops when the control bridge is unavailable.
      new InjectBridgeRelay().apply(compiler)
    }

    // Hot chunks are fetched from the extension origin (disk), so prune superseded
    // generations or long sessions accumulate stale files in what ships.
    new PruneStaleHotUpdates().apply(compiler)

    // The same for a lazy chunk no entry of this compile reaches any more.
    new PruneUnreachableChunks().apply(compiler)
  }
}
