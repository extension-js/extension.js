// @ts-check

// Make dynamic import & chunk splitting works.
const ChuckLoaderRuntimePlugin = require('./ChunkLoader.js')
// Ban invalid file names in web extension
const NoDangerNamePlugin = require('./NoDangerNamePlugin.js')
// Provide support for MV3
const ServiceWorkerEntryPlugin = require('./ServiceWorkerPlugin.js')
// Content script
const InitialChunkFilePlugin = require('./InitialChunkFile.js')
// Automatically tweak HMR server
const HMRDevServerPlugin = require('./HMRDevServer.js')
// Detect browser / chrome API
const BrowserRuntime = require('./RuntimeModules/BrowserRuntime.js')

module.exports = class WebExtensionPlugin {
  /**
   * @param {import('../../index.d.ts').WebExtensionPluginOptions} options
   */
  constructor(options = {}) {
    const { background } = options
    if (background) {
      const { serviceWorkerEntry, pageEntry } = background
      if ('entry' in background || 'manifest' in background) {
        throw new Error(
          '[webpack-extension-target] background.entry and background.manifest has been removed. Use background.pageEntry and/or background.serviceWorkerEntry instead.',
        )
      }
      if (serviceWorkerEntry && serviceWorkerEntry === pageEntry) {
        throw new Error(
          `[webpack-extension-target] background.serviceWorkerEntry must not be the same as background.pageEntry. Service Worker entry only supports importScript, but importScript does not exist in background page (mv2) or limited event page (mv3).
    A possible fix is to create two new files to be the service worker entry and the page entry, then those two files imports the background entry.`,
        )
      }
    }
    this.options = options
  }
  /**
   * @param {import("webpack").Compiler} compiler
   */
  apply(compiler) {
    const { background, experimental_output } = this.options
    if (background?.serviceWorkerEntry) {
      const serviceWorkerEntry = this.options.background?.serviceWorkerEntry
      const output = serviceWorkerEntry ? this.options.experimental_output?.[serviceWorkerEntry] : false
      new ServiceWorkerEntryPlugin(background, !!output).apply(compiler)
    }
    if (experimental_output) new InitialChunkFilePlugin(this.options).apply(compiler)
    if (this.options.hmrConfig !== false) new HMRDevServerPlugin().apply(compiler)
    new ChuckLoaderRuntimePlugin(this.options.background || {}).apply(compiler)
    new NoDangerNamePlugin().apply(compiler)

    // better preset
    compiler.hooks.environment.tap(WebExtensionPlugin.name, () => {
      const { output } = compiler.options
      if (output.environment.dynamicImport !== false) output.environment.dynamicImport = true
      if (output.hotUpdateChunkFilename !== undefined) output.hotUpdateChunkFilename = 'hot/[id].[fullhash].js'
      if (output.hotUpdateMainFilename !== undefined) output.hotUpdateMainFilename = 'hot/[runtime].[fullhash].json'
    })

    // browser runtime
    compiler.hooks.compilation.tap(WebExtensionPlugin.name, (compilation) => {
      compilation.hooks.runtimeRequirementInTree
        .for(BrowserRuntime.RuntimeGlobal)
        .tap(WebExtensionPlugin.name, (chunk) => {
          compilation.addRuntimeModule(chunk, BrowserRuntime(compiler.webpack, !!this.options.weakRuntimeCheck))
          return true
        })
    })
  }
}
