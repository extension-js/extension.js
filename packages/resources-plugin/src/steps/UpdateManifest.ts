import {Compiler, Compilation, sources} from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'
import {WebResourcesPluginInterface, Manifest} from '../../types'

interface ContentData {
  feature: string
  matches: string[] | undefined
}

export default class UpdateManifest {
  private readonly manifestPath: string

  constructor(options: WebResourcesPluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private addFolderToWebResourcesField(manifest: Manifest, data: ContentData) {
    const isV2 = manifest.manifest_version === 2
    const isV3 = manifest.manifest_version === 3
    // const contentPath = `${data.feature}/*`
    const contentPath = 'web_accessible_resources/*'

    // Check for Manifest V2
    if (isV2) {
      if (!manifest.web_accessible_resources) {
        manifest.web_accessible_resources = [contentPath]
      } else if (Array.isArray(manifest.web_accessible_resources)) {
        if (!manifest.web_accessible_resources.includes(contentPath)) {
          manifest.web_accessible_resources.push(contentPath)
        }
      }
    }

    // Check for Manifest V3
    if (isV3) {
      const newResource = {
        resources: ['web_accessible_resources/*'],
        matches: data.matches
      }

      if (!manifest.web_accessible_resources) {
        manifest.web_accessible_resources = [newResource]
      } else if (Array.isArray(manifest.web_accessible_resources)) {
        // Check if the resource already exists
        const existingResource = manifest.web_accessible_resources.find(
          (resource) =>
            JSON.stringify(resource.matches) === JSON.stringify(data.matches)
        )

        if (existingResource) {
          if (!existingResource.resources.includes(contentPath)) {
            existingResource.resources.push(contentPath)
          }
        } else {
          manifest.web_accessible_resources.push(newResource)
        }
      }
    }

    return manifest
  }

  apply(compiler: Compiler) {
    const scriptFields = manifestFields(this.manifestPath).scripts

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

            const manifestSource = assets['manifest.json']
              ? assets['manifest.json'].source().toString()
              : require(this.manifestPath)

            const manifest: Manifest = JSON.parse(manifestSource)

            const matches =
              manifest.content_scripts?.flatMap(
                (contentScript) => contentScript.matches || []
              ) || []

            let patchedManifest = manifest

            for (const [feature] of Object.entries(scriptFields)) {
              if (feature.startsWith('content_scripts')) {
                const contentData = {feature, matches}

                patchedManifest = this.addFolderToWebResourcesField(
                  patchedManifest,
                  contentData
                )
              }
            }

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
