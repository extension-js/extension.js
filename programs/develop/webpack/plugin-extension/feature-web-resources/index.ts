import webpack, {Compilation, Compiler, sources} from 'webpack'
import {
  type FilepathList,
  type PluginInterface,
  type Manifest
} from '../../webpack-types'
import * as utils from '../../lib/utils'

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
      []
    const webAccessibleResourcesV2: string[] = []

    for (const [entryName, resources] of Object.entries(entryImports)) {
      const contentScript = manifest.content_scripts?.find((script) => {
        console.log({
          script,
          entryName,
          includes: script.js?.some((jsFile: string) =>
            jsFile.includes(entryName)
          )
        })
        return (
          script.js &&
          script.js.some((jsFile: string) => jsFile.includes(entryName))
        )
      })

      if (contentScript) {
        const matches = contentScript.matches || []
        if (manifest.manifest_version === 3) {
          webAccessibleResourcesV3.push({
            resources: resources.filter(
              (resource) => !resource.endsWith('.map')
            ),
            matches
          })
        } else {
          webAccessibleResourcesV2.push(...resources)
        }
      }
    }

    if (manifest.manifest_version === 3) {
      manifest.web_accessible_resources =
        webAccessibleResourcesV3 as Manifest['web_accessible_resources']
    } else {
      // @ts-expect-error web_accessible_resources v2 is not in the manifest v3 type
      manifest.web_accessible_resources = Array.from(
        new Set(webAccessibleResourcesV2)
      )
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
