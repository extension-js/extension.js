// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import {rememberBuildResolve} from '../shared/script-graph'
import {AddBaseUriRuntimeModule} from './steps/add-base-uri-runtime-module'
import {AddContentScriptWrapper} from './steps/add-content-script-wrapper'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'
import {AddScripts} from './steps/add-scripts'
import {CompileMainWorldScripts} from './steps/compile-main-world-scripts'
import {KeepCompletionValue} from './steps/keep-completion-value'
import {KeepGetURLImportsNative} from './steps/keep-geturl-imports-native'
import {PairRuntimeMainWorldBridges} from './steps/pair-runtime-main-world-bridges'
import {PlaceRuntimeScriptSheets} from './steps/place-runtime-script-sheets'
import {PruneMainWorldBridges} from './steps/prune-main-world-bridges'
import {RootInjectedSheetUrls} from './steps/root-injected-sheet-urls'
import {StampWebkitUtf8Bom} from './steps/stamp-webkit-utf8-bom'
import {TakeExtensionBase} from './steps/take-extension-base'
import {TraceRuntimeLoadedFiles} from './steps/trace-runtime-loaded-files'
import {ValidateEmittedScriptSyntax} from './steps/validate-emitted-script-syntax'
import {WarnMainWorldRegistrationChanged} from './steps/warn-main-world-registration-changed'
import {WarnMissingBuildConstants} from './steps/warn-missing-build-constants'
import {WarnPageContextWorker} from './steps/warn-page-context-worker'
import {WarnPageRelativeScriptPath} from './steps/warn-page-relative-script-path'
import {WarnSplitInitialChunks} from './steps/warn-split-initial-chunks'
import {WarnUnshippedRuntimeAssets} from './steps/warn-unshipped-runtime-assets'

export class ScriptsPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly pageList?: FilepathList
  public readonly browser?: DevOptions['browser']
  public readonly devSession?: boolean
  public readonly define?: Record<string, unknown>

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.pageList = options.pageList
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.define = options.define
  }

  public apply(compiler: Compiler): void {
    const hasValidManifest =
      !!this.manifestPath &&
      fs.existsSync(this.manifestPath) &&
      fs.lstatSync(this.manifestPath).isFile()

    if (!hasValidManifest) {
      return
    }

    // The import walk below resolves with the block this build compiles
    // with, which already holds what extension.config.js merged in.
    rememberBuildResolve(
      (compiler.options.context as string) || path.dirname(this.manifestPath),
      compiler.options.resolve
    )

    new AddScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      browser: this.browser
    }).apply(compiler)

    // In dev a MAIN world script compiles apart from the HMR runtime, which
    // would otherwise land on the host page. Takes its entry back out.
    new CompileMainWorldScripts({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      pageList: this.pageList,
      browser: this.browser
    }).apply(compiler)

    // A bundle ends on its own wrapping, and executeScript resolves with the
    // value a file ends on, so a scripts/ file is closed on that value.
    new KeepCompletionValue().apply(compiler)

    // The author's own call names the script alone, so the sheet of the CSS
    // modules a scripts/ file imports is carried by the file itself.
    new PlaceRuntimeScriptSheets({
      includeList: this.includeList || {},
      browser: this.browser
    }).apply(compiler)

    // A sheet on the visited page reads a url() against that page, so one
    // that ships as a file names its targets from the extension.
    new RootInjectedSheetUrls({
      includeList: this.includeList || {},
      browser: this.browser
    }).apply(compiler)

    // On Firefox the bridge answers the extension base to the first
    // statement of a MAIN world file, the one read no page script can stage.
    new TakeExtensionBase({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      pageList: this.pageList,
      browser: this.browser
    }).apply(compiler)

    // Firefox cannot name the extension from a MAIN world stack, so a file
    // registered there at runtime is paired with the bridge that publishes it.
    new PairRuntimeMainWorldBridges({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      pageList: this.pageList,
      browser: this.browser
    }).apply(compiler)

    // Runtime-loaded files the module graph cannot see (importScripts, executeScript
    // files payloads): copied through verbatim, missing references warn.
    new TraceRuntimeLoadedFiles({
      manifestPath: this.manifestPath,
      browser: this.browser
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
      includeList: this.includeList || {},
      pageList: this.pageList,
      browser: this.browser,
      devSession: this.devSession
    }).apply(compiler)

    if (compiler.options.mode === 'production') {
      new AddPublicPathRuntimeModule({
        browser: this.browser,
        manifestPath: this.manifestPath
      }).apply(compiler)
    }

    // Every mode: a worker entry that builds a URL from the base must not
    // read document, and a page keeps the same extension-root base.
    new AddBaseUriRuntimeModule({
      browser: this.browser,
      manifestPath: this.manifestPath
    }).apply(compiler)

    new PruneMainWorldBridges({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // swc tolerates some early syntax errors and emits them into the bundle; the
    // browser then silently never injects the file. Fail loudly in every mode.
    new ValidateEmittedScriptSyntax().apply(compiler)

    new StampWebkitUtf8Bom({browser: this.browser}).apply(compiler)

    // A user cache group can split an entry into several initial files while
    // every surface loads one. The build stays green, so name it here.
    new WarnSplitInitialChunks().apply(compiler)

    // The worker file ships, but the browser refuses to start it from a
    // script running in the page. Say so instead of leaving it to runtime.
    new WarnPageContextWorker().apply(compiler)

    // Firefox resolves a path without a leading slash against the page that
    // registers it and stays silent when that file is missing.
    new WarnPageRelativeScriptPath({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      pageList: this.pageList,
      browser: this.browser
    }).apply(compiler)

    // A dev session picks each scripts/ file's world as it starts, so a
    // MAIN world registration written later is named with what to do.
    new WarnMainWorldRegistrationChanged({
      manifestPath: this.manifestPath,
      includeList: this.includeList || {},
      pageList: this.pageList
    }).apply(compiler)

    // A constant the author forgot to define reads as a bare global in the
    // background and kills it at start while the build stays green.
    new WarnMissingBuildConstants({
      manifestPath: this.manifestPath,
      browser: this.browser,
      devSession: this.devSession,
      define: this.define
    }).apply(compiler)

    // A path a script builds or keeps as a string is not traced, so its
    // folder is left out while the build stays green. Name the folder.
    new WarnUnshippedRuntimeAssets({
      manifestPath: this.manifestPath
    }).apply(compiler)
  }
}
