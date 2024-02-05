import type webpack from 'webpack'
import {type ManifestPluginInterface} from './types'

// Manifest plugins
import EmitManifestPlugin from './steps/EmitManifestPlugin'
import UpdateManifestPlugin from './steps/UpdateManifestPlugin'
import AddDependenciesPlugin from './steps/AddDependenciesPlugin'
import CheckManifestFilesPlugin from './steps/CheckManifestFilesPlugin'
import ThrowIfRecompileIsNeeded from './steps/ThrowIfRecompileIsNeeded'

export default class ManifestPlugin {
  public readonly browser?: string
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: ManifestPluginInterface) {
    this.browser = options.browser
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  /**
   * ManifestPlugin is responsible for handling the manifest.json file.
   * It ensures that the files defined in the manifest have valid paths,
   * throwing errors if they don't. It also ensures the manifest is emitted
   * to the assets bundle, so other plugins can modify it, and stored
   * as file dependency so webpack can watch and trigger changes.
   * 
   * The plugin also has a guard against recompiling entrypoints
   * at runtime, throwing an error if any of those files change.
   */
  public apply(compiler: webpack.Compiler) {
    // 1 - Emit the manifest to the assets bundle.
    // It doesn't change the manifest, it just ensures
    // it's emitted to the assets bundle so other plugins
    // can modify it.
    new EmitManifestPlugin({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // 2 - Ensure the files defined in the manifest have valid paths,
    // throwing errors if they don't.
    new CheckManifestFilesPlugin({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // 3 - This is the end result of the manifest plugin, it updates the
    // manifest with the output path of relevant files.
    new UpdateManifestPlugin({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)

    // 4 - Ensure this manifest is stored as file dependency
    // so webpack can watch and trigger changes.
    new AddDependenciesPlugin([this.manifestPath]).apply(compiler)

    // 5 - Some files in manifest are used as entrypoints. Since
    // we can't recompile entrypoints at runtime, we need to
    // throw an error if any of those files change.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      exclude: this.exclude
    }).apply(compiler)
  }
}
