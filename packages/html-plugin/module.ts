import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation, type Compiler} from 'webpack'

import {type HtmlPluginInterface} from './types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {
  getFilePathWithinFolder,
  getFilePathSplitByDots
} from './helpers/getResourceName'
// import WatchRunUpdater from './plugins/WatchRunUpdater'
import shouldExclude from './helpers/shouldExclude'
import getAssetsFromHtml from './lib/getAssetsFromHtml'
import {fileError} from './helpers/messages'
import patchHtml from './lib/patchHtml'
// import WriteReloaderHtmlFilePlugin from './plugins/WriteReloaderHtmlFilePlugin'

export default class HtmlPlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]
  public readonly experimentalHMREnabled?: boolean

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
    this.experimentalHMREnabled = options.experimentalHMREnabled || false
  }

  private manifestNotFoundError(compilation: webpack.Compilation) {
    const errorMessage = `A manifest file is required for this plugin to run.`

    compilation.errors.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private entryNotFoundWarn(
    compilation: webpack.Compilation,
    feature: string,
    htmlFilePath: string
  ) {
    const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
    const errorMessage = `File path \`${htmlFilePath}\` not found. ${hintMessage}`

    compilation.warnings.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private fileNotFoundWarn(
    compilation: webpack.Compilation,
    feature: string,
    htmlFilePath: string
  ) {
    const errorMessage = fileError(feature, htmlFilePath)

    compilation.warnings.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private shouldEmitFile(context: string, file: string) {
    if (!this.exclude) return false

    const contextFile = path.relative(context, file)
    const shouldExcludeFile = shouldExclude(this.exclude, contextFile)

    // if there are no exclude folder, exclude nothing
    if (shouldExcludeFile) return false

    return true
  }

  private generateScripts(compiler: Compiler) {
    const manifest = require(this.manifestPath)
    const htmlFields = manifestFields(this.manifestPath, manifest).html

    for (const field of Object.entries(htmlFields)) {
      const [feature, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource?.html) {
        if (!fs.existsSync(resource?.html)) return

        const htmlAssets = getAssetsFromHtml(resource?.html)
        const fileAssets = htmlAssets?.js || []

        for (const asset of fileAssets) {
          const fileName = getFilePathSplitByDots(feature, asset)
          const context = compiler.options.context || ''
          const fileNameExt = path.extname(fileName)
          const fileNameNoExt = fileName.replace(fileNameExt, '')

          // Specifically for JS entries, we don't warn users
          // at first that the file is missing. Instead, we
          // ignore it and let other plugins throw the error.
          // During watchRun, we can check if the file exists
          // and recompile if it does.
          if (fs.existsSync(asset)) {
            if (this.shouldEmitFile(context, asset)) {
              compiler.options.entry = {
                ...compiler.options.entry,
                // https://webpack.js.org/configuration/entry-context/#entry-descriptor
                [fileNameNoExt]: {
                  import: [asset]
                }
              }
            }
          }
        }
      }
    }
  }

  public apply(compiler: webpack.Compiler): void {
    // Add the HTML to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionHtmlPlugin4',
            // Add additional assets to the compilation.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            // Do not emit if manifest doesn't exist.
            if (!fs.existsSync(this.manifestPath)) {
              this.manifestNotFoundError(compilation)
              return
            }

            if (compilation.errors.length > 0) return

            // Generate all assets declared in the HTML file.
            // This includes CSS, JS, and static assets.
            // - CSS will be injected into the HTML file.
            // - JS will be output as webpack entries.
            // - Static assets will be copied to the output directory.
            const manifestSource = assets['manifest.json']
              ? assets['manifest.json'].source()
              : require(this.manifestPath)

            const manifest = JSON.parse(manifestSource.toString())
            const htmlFields = manifestFields(this.manifestPath, manifest).html

            for (const field of Object.entries(htmlFields)) {
              const [feature, resource] = field

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!fs.existsSync(resource?.html)) {
                  this.entryNotFoundWarn(compilation, feature, resource?.html)
                  return
                }

                const source = fs.readFileSync(resource?.html)
                const rawSource = new sources.RawSource(source)
                const context = compiler.options.context || ''

                if (this.shouldEmitFile(context, resource?.html)) {
                  compilation.emitAsset(
                    getFilePathWithinFolder(feature, resource?.html),
                    rawSource
                  )
                }
              }
            }
          }
        )
      }
    )

    // Add the assets within the HTML file to the compilation.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionHtmlPlugin4',
            // Derive new assets from the existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_DERIVED
          },
          (assets) => {
            if (compilation.errors.length > 0) return

            const manifestSource = assets['manifest.json']
              ? assets['manifest.json'].source()
              : require(this.manifestPath)

            const manifest = JSON.parse(manifestSource.toString())
            const htmlFields = manifestFields(this.manifestPath, manifest).html

            for (const field of Object.entries(htmlFields)) {
              const [feature, resource] = field

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                if (!fs.existsSync(resource?.html)) return

                const htmlAssets = getAssetsFromHtml(resource?.html)
                const fileAssets = [
                  ...(htmlAssets?.css || []),
                  ...(htmlAssets?.static || [])
                ]

                const scriptAssets = htmlAssets?.js || []

                for (const asset of scriptAssets) {
                  if (!fs.existsSync(asset)) {
                    this.fileNotFoundWarn(compilation, resource?.html, asset)
                    return
                  }
                }

                for (const asset of [...fileAssets]) {
                  if (!fs.existsSync(asset)) {
                    this.fileNotFoundWarn(compilation, feature, asset)
                    return
                  }

                  const source = fs.readFileSync(asset)
                  const rawSource = new sources.RawSource(source)
                  const context = compiler.options.context || ''

                  if (this.shouldEmitFile(context, asset)) {
                    compilation.emitAsset(
                      getFilePathWithinFolder(feature, asset),
                      rawSource
                    )
                  }
                }
              }
            }
          }
        )
      }
    )

    // Add the scripts within the HTML file to the compilation.
    this.generateScripts(compiler)

    // Ensure this HTML file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionHtmlPlugin4',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifestSource = compilation.getAsset('manifest.json')
              ? compilation.getAsset('manifest.json')?.source.source()
              : require(this.manifestPath)

            const manifest = JSON.parse(manifestSource.toString())
            const htmlFields = manifestFields(this.manifestPath, manifest).html

            for (const field of Object.entries(htmlFields)) {
              const [, resource] = field

              if (resource?.html) {
                const fileDependencies = new Set(compilation.fileDependencies)

                if (fs.existsSync(resource?.html)) {
                  const fileResources = [
                    resource?.html,
                    ...resource?.css,
                    ...resource?.static
                  ]

                  for (const thisResource of fileResources) {
                    if (!fileDependencies.has(thisResource)) {
                      fileDependencies.add(thisResource)
                      compilation.fileDependencies.add(thisResource)
                    }
                  }
                }
              }
            }
          }
        )
      }
    )

    // Update the HTML file with paths resolved.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionHtmlPlugin',
            // Summarize the list of existing assets.

            // make this earlier or the manifest output latter
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
          },
          (assets) => {
            if (compilation.errors.length > 0) return

            const manifestSource = assets['manifest.json']?.source()
            const manifest = JSON.parse((manifestSource || '').toString())
            const htmlFields = manifestFields(this.manifestPath, manifest).html

            for (const field of Object.entries(htmlFields)) {
              const [feature, resource] = field

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                if (!fs.existsSync(resource?.html)) return

                const updatedHtml = patchHtml(
                  feature,
                  resource?.html,
                  this.exclude!
                )

                const assetName = getFilePathWithinFolder(
                  feature,
                  resource?.html
                )

                const rawSource = new sources.RawSource(updatedHtml)
                const context = compiler.options.context || ''

                if (this.shouldEmitFile(context, resource?.html)) {
                  compilation.updateAsset(assetName, rawSource)
                }
              }
            }
          }
        )
      }
    )

    // new WriteReloaderHtmlFilePlugin({
    //   manifestPath: this.manifestPath,
    //   exclude: this.exclude
    // }).apply(compiler)
  }
}
