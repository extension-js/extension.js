import webpack, {Compilation, Compiler, sources} from 'webpack'
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
 * - Assets imported from content_scripts files.
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
    compilation: webpack.Compilation,
    entryImports: Record<string, string[]>
  ) {
    const manifest = utils.getManifestContent(compilation, this.manifestPath!)

    const webAccessibleResourcesV3: {resources: string[]; matches: string[]}[] =
      manifest.web_accessible_resources || []
    const webAccessibleResourcesV2: string[] =
      manifest.web_accessible_resources || []

    for (const [entryName, resources] of Object.entries(entryImports)) {
      const contentScript = manifest.content_scripts?.find((script) => {
        return (
          script.js &&
          script.js.some((jsFile: string) => jsFile.includes(entryName))
        )
      })

      if (contentScript) {
        const matches = contentScript.matches || []
        if (manifest.manifest_version === 3) {
          const existingResource = webAccessibleResourcesV3.find(
            (resourceEntry) =>
              resourceEntry.matches.some((match) => matches.includes(match))
          )

          if (existingResource) {
            resources.forEach((resource) => {
              if (
                !existingResource.resources.includes(resource) &&
                !resource.endsWith('.map')
              ) {
                existingResource.resources.push(resource)
              }
            })
          } else {
            webAccessibleResourcesV3.push({
              resources: resources.filter(
                (resource) => !resource.endsWith('.map')
              ),
              // We pass `matches` from `content_scripts` to `web_accessible_resources`,
              // but `web_accessible_resources` has stricter rules, so we need to sanitize them
              matches: cleanMatches(matches)
            })
          }
        } else {
          resources.forEach((resource) => {
            if (!webAccessibleResourcesV2.includes(resource)) {
              webAccessibleResourcesV2.push(resource)
            }
          })
        }
      }
    }

    if (manifest.manifest_version === 3) {
      if (webAccessibleResourcesV3.length > 0) {
        manifest.web_accessible_resources =
          webAccessibleResourcesV3 as Manifest['web_accessible_resources']
      }
    } else {
      if (webAccessibleResourcesV2.length > 0) {
        // @ts-expect-error - web_accessible_resources is a string[] in V2
        manifest.web_accessible_resources = Array.from(
          new Set(webAccessibleResourcesV2)
        )
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
