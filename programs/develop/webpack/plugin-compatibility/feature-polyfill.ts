import rspack, {type Compiler} from '@rspack/core'

interface PolyfillPluginInterface {
  manifestPath: string
  browser?: string
}

/**
 * PolyfillPlugin is responsible for providing the `browser`
 * global variable to the extension's codebase.
 */
export class PolyfillPlugin {
  public readonly manifestPath: string
  public readonly browser?: string

  constructor(options: PolyfillPluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser
  }

  apply(compiler: Compiler) {
    new rspack.ProvidePlugin({
      browser: require.resolve('webextension-polyfill')
    }).apply(compiler)
  }
}
