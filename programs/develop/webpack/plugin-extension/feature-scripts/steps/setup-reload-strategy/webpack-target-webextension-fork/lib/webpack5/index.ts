import ChunkLoaderRuntimePlugin from './ChunkLoader'
import NoDangerNamePlugin from './NoDangerNamePlugin'
import ServiceWorkerEntryPlugin from './ServiceWorkerPlugin'
import InitialChunkFilePlugin from './InitialChunkFile'
import HMRDevServerPlugin from './HMRDevServer'
import BrowserRuntimeModule, {
  RuntimeGlobal
} from './RuntimeModules/BrowserRuntime'

export default class WebExtensionPlugin {
  private readonly options: any

  constructor(options: any = {}) {
    const {background} = options
    if (background) {
      const {serviceWorkerEntry, pageEntry} = background
      if ('entry' in background || 'manifest' in background) {
        throw new Error(
          '[webpack-extension-target] background.entry and background.manifest has been removed. Use background.pageEntry and/or background.serviceWorkerEntry instead.'
        )
      }
      if (serviceWorkerEntry && serviceWorkerEntry === pageEntry) {
        throw new Error(
          `[webpack-extension-target] background.serviceWorkerEntry must not be the same as background.pageEntry. Service Worker entry only supports importScript, but importScript does not exist in background page (mv2) or limited event page (mv3).
    A possible fix is to create two new files to be the service worker entry and the page entry, then those two files imports the background entry.`
        )
      }
    }
    this.options = options
  }

  apply(compiler: any) {
    const {background, experimental_output} = this.options
    if (background?.serviceWorkerEntry) {
      const serviceWorkerEntry = this.options.background?.serviceWorkerEntry
      const output = serviceWorkerEntry
        ? this.options.experimental_output?.[serviceWorkerEntry]
        : false
      new ServiceWorkerEntryPlugin(background, !!output).apply(compiler)
    }
    if (experimental_output)
      new InitialChunkFilePlugin(this.options).apply(compiler)
    if (this.options.hmrConfig !== false)
      new HMRDevServerPlugin().apply(compiler)
    // Pass full plugin options so runtime can be world-aware for content scripts.
    new ChunkLoaderRuntimePlugin(this.options).apply(compiler)
    new NoDangerNamePlugin().apply(compiler)

    // better preset
    compiler.hooks.environment.tap(WebExtensionPlugin.name, () => {
      const {output} = compiler.options
      if (output.environment.dynamicImport !== false)
        output.environment.dynamicImport = true
      if (output.hotUpdateChunkFilename !== undefined)
        output.hotUpdateChunkFilename = 'hot/[id].[fullhash].js'
      if (output.hotUpdateMainFilename !== undefined)
        output.hotUpdateMainFilename = 'hot/[runtime].[fullhash].json'
    })

    // browser runtime
    compiler.hooks.compilation.tap(
      WebExtensionPlugin.name,
      (compilation: any) => {
        compilation.hooks.runtimeRequirementInTree
          .for(RuntimeGlobal)
          .tap(WebExtensionPlugin.name, (chunk: any) => {
            compilation.addRuntimeModule(
              chunk,
              BrowserRuntimeModule(
                compiler.webpack,
                !!this.options.weakRuntimeCheck
              )
            )
            return true
          })
      }
    )
  }
}
