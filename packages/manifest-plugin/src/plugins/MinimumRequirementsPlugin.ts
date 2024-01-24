import webpack, {type Compiler, Compilation} from 'webpack'

export default class MinimumRequirementsPlugin {
  private manifestFieldError(requiredField: string) {
    const hintMessage = `Update your manifest.json file to run your extension.`
    const errorMessage = `Field \`${requiredField}\` is required. ${hintMessage}`
    return errorMessage
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'ManifestPlugin (MinimumRequirementsPlugin)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ManifestPlugin (MinimumRequirementsPlugin)',
            // Add additional assets to the compilation.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          (assets) => {
            if (compilation.errors.length > 0) return

            const manifestAsset = assets['manifest.json']
            const manifestContent = manifestAsset.source().toString()
            const manifest = JSON.parse(manifestContent.replace(/\n/g, ''))

            if (!manifest.manifest_version) {
              const errorMessage = this.manifestFieldError('manifest_version')
              compilation.errors.push(
                new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
              )
            }

            if (!manifest.version) {
              const errorMessage = this.manifestFieldError('version')
              compilation.errors.push(
                new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
              )
            }

            if (!manifest.name) {
              const errorMessage = this.manifestFieldError('name')
              compilation.errors.push(
                new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
              )
            }
          }
        )
      }
    )
  }
}
