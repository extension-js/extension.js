import {type Compiler, Compilation, sources} from 'webpack'
import {WebResourcesPluginInterface} from '../../types'

export default class UpdateManifest {
  private readonly manifestPath: string

  constructor(options: WebResourcesPluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private addFolderToWebResourcesField(manifest: Record<string, any>) {
    const isV2 = manifest.manifest_version === 2
    const isV3 = manifest.manifest_version === 3

    // Check for Manifest V2
    if (isV2) {
      if (!manifest.web_accessible_resources) {
        manifest.web_accessible_resources = ['web_accessible_resources/*']
      } else if (Array.isArray(manifest.web_accessible_resources)) {
        const newResource = 'web_accessible_resources/*'
        if (!manifest.web_accessible_resources.includes(newResource)) {
          manifest.web_accessible_resources.push(newResource)
        }
      }
    }

    // Check for Manifest V3
    else if (isV3) {
      if (!manifest.web_accessible_resources) {
        manifest.web_accessible_resources = [
          {
            resources: ['web_accessible_resources/*'],
            matches: ['<all_urls>']
          }
        ]
      } else if (Array.isArray(manifest.web_accessible_resources)) {
        manifest.web_accessible_resources.forEach(
          (resource: any, index: number) => {
            const newResource = `web_accessible_resources/resource-${index}/*`
            if (!resource.resources.includes(newResource)) {
              resource.resources.push(newResource)
            }
          }
        )
      }
    }

    return manifest
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'ResourcesPlugin (UpdateManifest)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ResourcesPlugin (UpdateManifest)',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          (assets) => {
            if (compilation.errors.length > 0) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const patchedManifest = this.addFolderToWebResourcesField(manifest)

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)

            if (assets['manifest.json']) {
              compilation.updateAsset('manifest.json', rawSource)
            } else {
              compilation.emitAsset('manifest.json', rawSource)
            }
          }
        )
      }
    )
  }
}
