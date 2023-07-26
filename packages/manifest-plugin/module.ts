import type webpack from 'webpack'
import {type ManifestPluginInterface} from './types'

// Manifest plugins
import EmitManifestPlugin from './plugins/EmitManifestPlugin'
import MinimumRequirementsPlugin from './plugins/MinimumRequirementsPlugin'
import UpdateManifestPlugin from './plugins/UpdateManifestPlugin'
import AddDependenciesPlugin from './plugins/AddDependenciesPlugin'
// import WatchRecompilePlugin from './plugins/WatchRecompilePlugin'

export default class ManifestPlugin {
  public readonly browser?: string
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: ManifestPluginInterface) {
    this.browser = options.browser
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler) {
    // Add the manifest to the assets bundle.
    // This is important so other plugins can
    // get it via the compilation.assets object,
    // allowing them to modify it.
    new EmitManifestPlugin({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // Before attempting to do anything, check
    // if manifest meets the minimum requirements.
    new MinimumRequirementsPlugin().apply(compiler)

    // Override the manifest with the updated version.
    new UpdateManifestPlugin({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)

    // Ensure this manifest is stored as file dependency
    // so webpack can watch and trigger changes.
    new AddDependenciesPlugin([this.manifestPath]).apply(compiler)
  }
}
