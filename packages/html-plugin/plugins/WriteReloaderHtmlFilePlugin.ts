import path from 'path'
import fs from 'fs'
// @ts-ignore
import utils from 'parse5-utils'
import type webpack from 'webpack';
import {sources, Compilation} from 'webpack'

import {type HtmlPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {getFilePathWithinFolder} from '../helpers/getResourceName'
import shouldExclude from '../helpers/shouldExclude'
import patchHtml from '../lib/patchHtml'

export default class WriteReloaderHtmlFilePlugin {
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

  private patchHtmlReloadPlugin(htmlEntry: string) {
    const htmlFile = htmlEntry
    const htmlDocument = utils.parse(htmlFile)

    for (let node of htmlDocument.childNodes) {
      if (node.nodeName !== 'html') continue

      for (const htmlChildNode of node.childNodes) {
        // We don't really care whether the asset is in the head or body
        // element, as long as it's not a regular text note, we're good.
        if (htmlChildNode.nodeName === 'body') {
          // Insert the HMR script just before </body>
          const reloadScript = utils.createNode('script')
          const reloadScriptName = `/extension-html-reloader.js`

          node = utils.setAttribute(reloadScript, 'src', reloadScriptName)
          node = utils.append(htmlChildNode, reloadScript)
        }
      }

      return utils.serialize(htmlDocument)
    }
  }

  public apply(compiler: webpack.Compiler): void {
    if (compiler.options.mode !== 'development') return

    // Emit the script file needed to reload
    // HTML files in case they have none.
    const htmlFields = manifestFields(this.manifestPath).html

    for (const field of Object.entries(htmlFields)) {
      const [, resource] = field

      if (resource) {
        if (resource.js.length === 0) {
          // Add a file within the dist of this plugin.
          // this will resolve to the user node_modules folder
          const hmrFileContent = ''

          const reloadLib = path.join(
            __dirname,
            '..',
            'lib',
            'extension-html-reloader.js'
          )

          fs.writeFileSync(reloadLib, hmrFileContent)

          compiler.options.entry = {
            ...compiler.options.entry,
            // https://webpack.js.org/configuration/entry-context/#entry-descriptor
            'extension-html-reloader': {
              import: [reloadLib]
            }
          }
        }
      }
    }

    // Update the HTML with the new script.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionHtmlPlugin',
            // make this earlier or the manifest output latter
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
          },
          (assets) => {
            if (compilation.errors.length > 0) return
            if (compilation.options.mode !== 'development') return

            const manifestSource = assets['manifest.json']?.source()
            const manifest = JSON.parse((manifestSource || '').toString())
            const htmlFields = manifestFields(this.manifestPath, manifest).html

            for (const field of Object.entries(htmlFields)) {
              const [feature, resource] = field

              if (resource) {
                if (resource.js.length === 0) {
                  const updatedHtml = patchHtml(
                    feature,
                    resource?.html,
                    this.exclude!
                  )

                  const patchUpdatedHtml =
                    this.patchHtmlReloadPlugin(updatedHtml)
                  const assetName = getFilePathWithinFolder(
                    feature,
                    resource?.html
                  )

                  const rawSource = new sources.RawSource(patchUpdatedHtml)
                  const context = compiler.options.context || ''

                  if (this.shouldEmitFile(context, resource?.html)) {
                    compilation.updateAsset(assetName, rawSource)
                  }
                }
              }
            }
          }
        )
      }
    )
  }
}
