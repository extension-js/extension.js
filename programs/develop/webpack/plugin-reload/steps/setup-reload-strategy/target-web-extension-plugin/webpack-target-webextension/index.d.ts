import { Compiler } from 'webpack'

export interface BackgroundOptions {
  /** Undocumented. */
  noDynamicEntryWarning?: boolean
  /**
   * @deprecated
   * Use pageEntry and/or serviceWorkerEntry instead.
   */
  entry?: never
  /** @deprecated */
  manifest?: never
  /**
   * The entry point of the background page.
   */
  pageEntry?: string
  /**
   * The entry point of the service worker.
   */
  serviceWorkerEntry?: string
  /**
   * Only affects Manifest V3.
   *
   * Load all chunks at the beginning to workaround the Chrome bug
   * <https://bugs.chromium.org/p/chromium/issues/detail?id=1198822>.
   *
   * NOT working for rspack.
   *
   * @defaultValue true
   */
  eagerChunkLoading?: boolean
  /**
   * Add the support code that uses
   * `chrome.scripting.executeScript` (MV3) or
   * `chrome.tabs.executeScript` (MV2) when
   * dynamic import does not work for chunk loading in the content script.
   * @defaultValue true
   */
  classicLoader?: boolean
  /**
   * Add a try-catch wrapper around the entry file of serviceWorkerEntry
   * so if the initial code throws, you can still open the console of it.
   *
   * Does not work in rspack.
   *
   * @defaultValue true
   */
  tryCatchWrapper?: boolean
}

export interface WebExtensionPluginOptions {
  /** Background page/service worker options. */
  background?: BackgroundOptions
  /**
   * Configure HMR automatically for you.
   * @defaultValue true
   */
  hmrConfig?: boolean
  /**
   *
   * **This is an experimental API.**
   * **API might change at any time.**
   * **Please provide feedback!**
   *
   * This option helps the initial chunk loading of content scripts/the background service worker,
   * usually needed when `optimization.runtimeChunk` or `optimization.splitChunks.chunks` is used.
   *
   * This option accepts an object, where the keys are the entry name,
   * and the value is described below.
   *
   * This option replaces the HTMLWebpackPlugin where the background service worker and content scripts
   * do not use HTML to load files.
   *
   * If the value is a `string` (an output file name), for content scripts, it creates an extra
   * entry file to load all initial chunks **asynchronously** via dynamic import.
   * This asynchronous loading behavior is limited to the platform limit and **breaks**
   * [run_at](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#run_at).
   *
   * If the value is a `string` (an output file name), for the background service worker (specified
   * via `options.background.serviceWorkerEntry`), it creates an extra entry file to load all
   * initial chunks **synchronously**.
   *
   * The file name specified MUST NOT be any existing file.
   *
   * If the value is a `function` (`(manifest: any, chunks: string[]) => void`), it requires
   * a "manifest.json" in the emitted files and lets you edit it on the fly to include all
   * the initial chunks. This option does not apply to the background service worker because
   * `manifest.json` does not accept multiple files.
   *
   * If the value is an `object` (`{ file: string; touch(manifest: any, file: string): void }`),
   * it generates a new file (see the behavior of `string` above) and provides a callback to
   * edit the `manifest.json` (see the behavior of `function` above).
   *
   * If the value is `false`, it asserts that this entry does not have more than one initial file,
   * otherwise, it will be a compile error.
   *
   * If the value is `undefined`, it silences the warning for the background service worker.
   *
   * You can also change your configuration to avoid `optimization.runtimeChunk` or `optimization.splitChunks.chunks`,
   * in this case, webpack only generates 1 initial file so you don't need this option.
   *
   * @defaultValue undefined
   * @example
   * ```ts
   * {
   *     // creates a entryName.js that dynamic import all the files needed.
   *     "contentScript1": "cs1.js",
   *     // edit the manifest.json directly to load all files synchronously.
   *     "contentScript2": (manifest, files) => {
   *         manifest.content_scripts[0].js = files;
   *         manifest.content_scripts[1].js = files;
   *     },
   *     "backgroundWorker": {
   *         file: "backgroundWorker.js",
   *         touch(manifest, file) {
   *             manifest.background.service_worker = file;
   *         }
   *     },
   * }
   * ```
   */
  experimental_output?: Record<
    string,
    // throw error if the entry has more than one initial chunk.
    | false
    // generate a new file to load all all the initial chunks
    // and provide a callback to set all initial files
    | string
    // provide a callback to set all initial files
    | ((manifest: any, chunks: string[]) => void)
    // generate a new file to load all the initial chunks
    | { file: string; touch(manifest: any, file: string): void }
  >
  /**
   * Use a weak runtime check, in case the code will be evaluated during the compile.
   *
   * Enable this option when you're using mini-css-extract-plugin.
   * @defaultValue false
   */
  weakRuntimeCheck?: boolean
}
export default class WebExtensionPlugin {
  constructor(options?: WebExtensionPluginOptions)
  apply(compiler: Compiler): void
}
export = WebExtensionPlugin
