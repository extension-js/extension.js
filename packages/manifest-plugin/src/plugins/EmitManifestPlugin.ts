import fs from 'fs'
import webpack, {sources} from 'webpack'

interface Options {
  manifestPath: string
}

export default class EmitManifestPlugin {
  private readonly options: Options

  constructor(options: Options) {
    this.options = options
  }

  private manifestNotFoundError(compilation: webpack.Compilation) {
    const hintMessage = `Ensure you have a manifest.json file at the root direcotry of your project.`
    const errorMessage = `A manifest file is required. ${hintMessage}`
    compilation.errors.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private manifestInvalidError(compilation: webpack.Compilation, error: any) {
    const hintMessage = `Update your manifest file and run the program again.`
    const errorMessage = `${error}. ${hintMessage}`
    compilation.errors.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionManifestPlugin',
      (compilation) => {
        // Fired when the compilation stops accepting new modules.
        compilation.hooks.seal.tap('BrowserExtensionManifestPlugin', () => {
          // Do not emit manifest if it doesn't exist.
          if (!fs.existsSync(this.options.manifestPath)) {
            this.manifestNotFoundError(compilation)
            return
          }

          // Do not emit manifest if json is invalid.
          try {
            JSON.parse(fs.readFileSync(this.options.manifestPath).toString())
          } catch (error: any) {
            this.manifestInvalidError(compilation, error)
            return
          }

          if (compilation.errors.length > 0) return

          const filename = 'manifest.json'
          const source = fs.readFileSync(this.options.manifestPath)
          const rawSource = new sources.RawSource(source)

          compilation.emitAsset(filename, rawSource)
        })
      }
    )
  }
}
