import type webpack from 'webpack'

// Manifest plugins
import {EmitManifest} from './steps/emit-manifest'
import {UpdateManifest} from './steps/update-manifest'
import {AddDependencies} from './steps/add-dependencies'
import {CheckManifestFiles} from './steps/check-manifest-files'
import {ThrowIfRecompileIsNeeded} from './steps/throw-if-recompile'

import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {DevOptions} from '../../../commands/dev'

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
export class ManifestPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface & {browser: DevOptions['browser']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: webpack.Compiler) {
    // 1 - Emit the manifest to the assets bundle.
    // It doesn't change the manifest, it just ensures
    // it's emitted to the assets bundle so other plugins
    // can modify it.
    new EmitManifest({
      manifestPath: this.manifestPath
    }).apply(compiler)

    // 2 - Ensure the files defined in the manifest have valid paths,
    // throwing errors if they don't.
    new CheckManifestFiles({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      excludeList: this.excludeList
    }).apply(compiler)

    // 3 - This is the end result of the manifest plugin, it updates the
    // manifest with the output path of relevant files.
    new UpdateManifest({
      manifestPath: this.manifestPath,
      excludeList: this.excludeList
    }).apply(compiler)

    // 4 - Ensure this manifest is stored as file dependency
    // so webpack can watch and trigger changes.
    new AddDependencies([this.manifestPath]).apply(compiler)

    // 5 - Some files in manifest are used as entrypoints. Since
    // we can't recompile entrypoints at runtime, we need to
    // throw an error if any of those files change.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      browser: this.browser,
      includeList: this.includeList
    }).apply(compiler)
  }
}
