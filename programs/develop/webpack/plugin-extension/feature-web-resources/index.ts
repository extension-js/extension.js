import {Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {CollectContentEntryImports} from './steps/collect-content-entry-imports'
import {PatchManifestWebResources} from './steps/patch-manifest-war'
import {generateManifestPatches as generateManifestPatchesUtil} from './web-resources-lib/generate-manifest'

/**
 * ResourcesPlugin is responsible for adding resources required
 * by the user and the content_scripts to the manifest.json file.
 *
 * Feature supported:
 *
 * - Assets imported from content_scripts files.
 * - web_accessible_resources paths in the manifest.json file.
 */
export class WebResourcesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser || 'chrome'
  }

  // For unit tests that call this private helper directly
  private generateManifestPatches(
    compilation: import('@rspack/core').Compilation,
    entryImports: Record<string, string[]>
  ) {
    generateManifestPatchesUtil(
      compilation,
      this.manifestPath,
      undefined,
      entryImports,
      this.browser
    )
  }

  apply(compiler: Compiler) {
    // 1 - Collect the content entry imports.
    // When a content_script imports a file, we
    // need to add it to the manifest.
    new CollectContentEntryImports({
      manifestPath: this.manifestPath,
      includeList: this.includeList
    }).apply(compiler)

    // 2 - Patch the manifest.json file to add the
    // web_accessible_resources paths. This is used
    // to add the web_accessible_resources paths.
    new PatchManifestWebResources({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)
  }
}
