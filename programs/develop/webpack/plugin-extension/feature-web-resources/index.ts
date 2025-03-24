import {Compilation, Compiler, sources} from '@rspack/core'
import {
  type FilepathList,
  type PluginInterface,
  type Manifest
} from '../../webpack-types'
import * as utils from '../../lib/utils'
import {cleanMatches} from './clean-matches'

/**
 * ResourcesPlugin is responsible for adding resources required
 * by the user and the content_scripts to the manifest.json file.
 *
 * Feature supported:
 *
 * - web_accessible_resources paths in the manifest.json file.
 * - Assets imported from content_scripts files (including CSS files)
 */
export class WebResourcesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  private generateManifestPatches(
    compilation: Compilation,
    entryImports: Record<string, string[]>
  ) {
    const manifest = utils.getManifestContent(compilation, this.manifestPath!)

    const webAccessibleResourcesV3: {resources: string[]; matches: string[]}[] =
      manifest.web_accessible_resources || []
    const webAccessibleResourcesV2: string[] =
      manifest.web_accessible_resources || []

    if (manifest.content_scripts && manifest.content_scripts.length > 0) {
      if (manifest.manifest_version === 3) {
        const contentWildcard = {
          resources: ['content_scripts/*'],
          matches: ['<all_urls>']
        }
        webAccessibleResourcesV3.push(contentWildcard)
      } else {
        webAccessibleResourcesV2.push('content_scripts/*')
      }
    }

    for (const [entryName, resources] of Object.entries(entryImports)) {
      const contentScript = manifest.content_scripts?.find((script) =>
        script.js?.some((jsFile: string) => jsFile.includes(entryName))
      )

      if (contentScript) {
        const matches = contentScript.matches || []

        // Filter out source maps and JS files, but keep CSS files
        const filteredResources = resources.filter(
          (resource) => !resource.endsWith('.map') && !resource.endsWith('.js')
        )

        if (filteredResources.length === 0) {
          continue
        }

        if (manifest.manifest_version === 3) {
          const existingResource = webAccessibleResourcesV3.find(
            (resourceEntry) =>
              resourceEntry.matches.some((match) => matches.includes(match))
          )

          if (existingResource) {
            filteredResources.forEach((resource) => {
              if (!existingResource.resources.includes(resource)) {
                existingResource.resources.push(resource)
              }
            })
          } else {
            webAccessibleResourcesV3.push({
              resources: filteredResources,
              matches: cleanMatches(matches)
            })
          }
        } else {
          filteredResources.forEach((resource) => {
            if (!webAccessibleResourcesV2.includes(resource)) {
              webAccessibleResourcesV2.push(resource)
            }
          })
        }
      }
    }

    // Only add web_accessible_resources if there are valid entries
    if (manifest.manifest_version === 3) {
      if (webAccessibleResourcesV3.length > 0) {
        manifest.web_accessible_resources =
          webAccessibleResourcesV3 as Manifest['web_accessible_resources']
      }
    } else {
      if (webAccessibleResourcesV2.length > 0) {
        manifest.web_accessible_resources = Array.from(
          new Set(webAccessibleResourcesV2)
        ) as Manifest['web_accessible_resources']
      }
    }

    const source = JSON.stringify(manifest, null, 2)
    const rawSource = new sources.RawSource(source)

    if (compilation.getAsset('manifest.json')) {
      compilation.updateAsset('manifest.json', rawSource)
    }
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'plugin-extension:feature-web-resources',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'plugin-extension:feature-web-resources',
            stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE
          },
          () => {
            const contentEntries: string[] = []
            const entryNames = Object.keys(this.includeList || {})

            for (const key of entryNames.filter(Boolean)) {
              if (key.startsWith('content_scripts')) {
                if (Array.isArray(key)) {
                  contentEntries.push(...key)
                } else if (typeof key === 'string') {
                  contentEntries.push(key)
                }
              }
            }

            const chunkGraph = compilation.chunkGraph
            const entryImports: Record<string, string[]> = {}

            compilation.entrypoints.forEach((entry, entryName) => {
              if (contentEntries.includes(entryName)) {
                const importedFiles: string[] = []

                entry.chunks.forEach((chunk) => {
                  const modules = Array.from(
                    chunkGraph.getChunkModulesIterable(chunk)
                  )

                  modules.forEach((module) => {
                    chunkGraph.getModuleChunks(module).forEach((chunk) => {
                      chunk.auxiliaryFiles.forEach((file) => {
                        if (!importedFiles.includes(file)) {
                          importedFiles.push(file)
                        }
                      })
                    })
                  })
                })

                entryImports[entryName] = importedFiles
              }
            })

            this.generateManifestPatches(compilation, entryImports)
          }
        )
      }
    )
  }
}
