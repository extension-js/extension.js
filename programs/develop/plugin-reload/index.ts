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
import {noteManifestPath} from './reload-dispatch'
import {isReloadSession} from './reload-session'
import {AddContentScriptReinject} from './steps/add-content-script-reinject'
import {
  type BridgeCoordinates,
  InjectBridgeProducer,
  readBootRegistrations,
  readDevBuild
} from './steps/inject-bridge-producer'
import {InjectBridgeRelay} from './steps/inject-bridge-relay'
import {InjectScriptsReplayShim} from './steps/inject-scripts-replay-shim'
import {KeepOpenTabStylesheets} from './steps/keep-open-tab-stylesheets'
import {PruneStaleHotUpdates} from './steps/prune-stale-hot-updates'
import {PruneUnreachableChunks} from './steps/prune-unreachable-chunks'
import {SetupDevContentScripts} from './steps/setup-dev-content-scripts'
import {SetupPageReload} from './steps/setup-page-reload'
import {SetupReloadStrategy} from './steps/setup-reload-strategy'
import {StableContentScriptNames} from './steps/stable-content-script-names'
import {StripContentScriptDevServerRuntime} from './steps/strip-content-script-dev-server-runtime'

export {
  type LoadedContentScripts,
  loadedContentScriptsFor,
  reloadForBuild
} from './build-reload'
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
export {
  type BuildHold,
  type CompilerReloads,
  createReloadSession,
  type ReloadPlan,
  type ReloadSession,
  reloadEachBuild
} from './reload-session'
export {readBootRegistrations, readDevBuild}
// The page side of reload. Registered ahead of plugin-web-extension, whose
// pages it adds to as they are declared.
export {SetupPageReload as PageReloadPlugin}

/**
 * ReloadPlugin owns the dev-only reload/HMR strategy end to end:
 *
 * - build-time injection of the reload runtime (SetupReloadStrategy, which
 *   asks plugin-web-extension's chunk loading target for the message
 *   fallback), the SW scripts-replay shim, and the control-bridge
 *   producer/relay instrumentation
 * - the reload session (reload-session.ts): what the browser last read,
 *   the classifier, the trim and merge a packaged browser needs, and the
 *   dispatch. plugin-browsers and the dev server's `--no-browser` path only
 *   say when a build was loaded and when it should reload
 *
 * Registration order matters: this plugin must be applied AFTER
 * plugin-web-extension, SetupReloadStrategy decorates the background and
 * content-script entries that feature-scripts' AddScripts declares.
 *
 * The whole pipeline is dev-only; `EXTENSION_NO_RELOAD=true` opts out. The
 * every-mode content-script wrapper (mount lifecycle) is NOT part of this
 * plugin. It lives in feature-scripts/steps/add-content-script-wrapper, and
 * this plugin adds the reinject runtime to it through its extension points.
 */
export class ReloadPlugin {
  public static readonly name = 'plugin-reload'

  public readonly manifestPath: string
  public readonly browser?: DevOptions['browser']
  private readonly devSession?: boolean
  private readonly bridge: BridgeCoordinates

  // Each dev session names its own bridge, and the environment is the
  // fallback for a config built without one.
  constructor(options: PluginInterface & BridgeCoordinates) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.bridge = {
      instanceId: options.instanceId,
      controlPort: options.controlPort,
      connectableHost: options.connectableHost
    }
  }

  public apply(compiler: Compiler): void {
    // Ahead of the gate below: the wrapper has always carried this runtime in
    // every dev session build, with or without the rest of the pipeline.
    new AddContentScriptReinject(this.devSession).apply(compiler)

    // Ahead of the gate too: a development output is never cleaned, session
    // or not, so the sheets an earlier compile left stay reachable.
    new KeepOpenTabStylesheets().apply(compiler)

    if (!isReloadSession(compiler.options.mode, this.devSession)) {
      return
    }

    const hasValidManifest =
      !!this.manifestPath &&
      fs.existsSync(this.manifestPath) &&
      fs.lstatSync(this.manifestPath).isFile()

    if (!hasValidManifest) {
      return
    }

    noteManifestPath(compiler, this.manifestPath)

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
      new InjectBridgeProducer(this.bridge).apply(compiler)

      // Forward content-script console to the SW relay (multi-context logs).
      // No-ops when the control bridge is unavailable.
      new InjectBridgeRelay({controlPort: this.bridge.controlPort}).apply(
        compiler
      )
    }

    // Hot chunks are fetched from the extension origin (disk), so prune superseded
    // generations or long sessions accumulate stale files in what ships.
    new PruneStaleHotUpdates().apply(compiler)

    // The same for a lazy chunk no entry of this compile reaches any more.
    new PruneUnreachableChunks().apply(compiler)
  }
}
