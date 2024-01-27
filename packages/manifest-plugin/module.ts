import type webpack from 'webpack'
import {type ManifestPluginInterface} from './src/types'

// Manifest plugins
import EmitManifestPlugin from './src/plugins/EmitManifestPlugin'
import UpdateManifestPlugin from './src/plugins/UpdateManifestPlugin'
import AddDependenciesPlugin from './src/plugins/AddDependenciesPlugin'
import CheckManifestFilesPlugin from './src/plugins/CheckManifestFilesPlugin'
import ThrowIfRecompileIsNeeded from './src/plugins/ThrowIfRecompileIsNeeded'

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

    new CheckManifestFilesPlugin({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // Override the manifest with the updated version.
    new UpdateManifestPlugin({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)

    // Ensure this manifest is stored as file dependency
    // so webpack can watch and trigger changes.
    new AddDependenciesPlugin([this.manifestPath]).apply(compiler)

    // Some files in manifest are used as entrypoints. Since
    // we can't recompile entrypoints at runtime, we need to
    // throw an error if any of those files change.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)
  }
}
