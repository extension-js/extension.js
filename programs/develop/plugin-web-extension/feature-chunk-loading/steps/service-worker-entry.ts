export default class WebExtensionServiceWorkerEntryPlugin {
  private readonly options: any

  constructor(options: any) {
    this.options = options
  }

  apply(compiler: any) {
    const entry = this.options.serviceWorkerEntry
    if (entry === undefined) return
    if (
      !(
        compiler.options.output.module ||
        compiler.options.experiments.outputModule
      )
    ) {
      const hook = compiler.hooks.entryOption
      // Set chunkLoading to import-scripts
      hook.tap(
        WebExtensionServiceWorkerEntryPlugin.name,
        (_context: any, entries: any) => {
          if (typeof entries === 'function') {
            if (this.options.noDynamicEntryWarning) return
            console.warn(`[webpack-extension-target] Dynamic entry points not supported yet.
You must manually set the chuck loading of entry point ${entry} to "import-scripts".

See https://webpack.js.org/configuration/entry-context/#entry-descriptor

Set background.noDynamicEntryWarning to true to disable this warning.
`)
          }
          const selectedEntry = entries?.[entry]
          if (!selectedEntry)
            throw new Error(
              `[webpack-extension-target] There is no entry called ${entry}.`
            )
          selectedEntry.chunkLoading = 'import-scripts'
        }
      )
    }
  }
}
