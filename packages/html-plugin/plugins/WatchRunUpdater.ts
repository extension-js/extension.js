import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'

import {type HtmlPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {getFilePathWithinFolder} from '../helpers/getResourceName'
import shouldExclude from '../helpers/shouldExclude'
import getAssetsFromHtml from '../lib/getAssetsFromHtml'
import patchHtml from '../lib/patchHtml'

export default class WatchRunUpdater {
  public readonly manifestPath: string
  public readonly exclude?: string[]
  public readonly experimentalHMREnabled?: boolean

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
    this.experimentalHMREnabled = options.experimentalHMREnabled || false
  }

  private shouldEmitFile(context: string, file: string) {
    if (!this.exclude) return false

    const contextFile = path.relative(context, file)
    const shouldExcludeFile = shouldExclude(this.exclude, contextFile)

    // if there are no exclude folder, exclude nothing
    if (shouldExcludeFile) return false

    return true
  }

  public apply(compiler: webpack.Compiler): void {
    // Watch for changes in the HTML file.
    // If change happened in a <script> tag, either by editing or
    // adding/removing, then we need to recompile.
    compiler.hooks.watchRun.tapAsync(
      'RunChromeExtensionPlugin',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set()
        const changedFile = files.values().next().value

        if (!changedFile || !changedFile.endsWith('.html')) {
          done()
          return
        }

        const context = compiler.options.context || ''

        // Ignore updates if file is excluded.
        if (!this.shouldEmitFile(context, changedFile)) {
          done()
          return
        }

        const changedFileContent = fs.readFileSync(changedFile, 'utf-8')

        const updatedHtmlEntries = getAssetsFromHtml(
          changedFile,
          changedFileContent
        )
        const updatedHtmlJsEntries = (
          updatedHtmlEntries?.js.filter((asset) =>
            this.shouldEmitFile(context, asset)
          ) || []
        ).map((asset) => {
          const extname = path.extname(asset)

          return path.basename(asset, extname)
        })
        compiler.hooks.afterCompile.tap(
          'BrowserExtensionHtmlPlugin',
          (compilation) => {
            if (
              compilation.errors?.length > 0 ||
              compilation.warnings?.length > 0
            )
              return

            const webpackEntries = compilation
              .getAssets()
              .filter((asset) => {
                const extWithoutJson =
                  compilation.options.resolve?.extensions?.map((ext) =>
                    ext.replace('.json', '')
                  )
                return extWithoutJson?.includes(path.extname(asset.name))
              })
              .map((asset) => {
                const extname = path.extname(asset.name)
                return path.basename(asset.name, extname)
              })

            const isNotEqual =
              JSON.stringify(webpackEntries.sort()) !==
              JSON.stringify(updatedHtmlJsEntries.sort())
            // const isNotEqual = webpackEntries.length !== 0 &&
            // webpackEntries.length !== updatedHtmlJsEntries.length

            if (changedFile.endsWith('html') && isNotEqual) {
              const webpackCompiler = webpack({
                ...compilation.options,
                output: {
                  ...compilation.options.output,
                  uniqueName: 'browser-extension-html-plugin'
                },
                plugins: [
                  ...compilation.options.plugins.filter((data) => {
                    return (data as any)?.name !== 'browserPlugins'
                  })
                ]
              } as any)

              webpackCompiler.run((err, stats) => {
                if (err) {
                  console.error(err)
                  return
                }

                console.log(
                  `Successfully compiled!!! -----------------------------------`
                )
              })
            }
          }
        )
        done()
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
  }
}
