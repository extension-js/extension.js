import webpack from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'
import shouldExclude from '../helpers/shoudExclude'
import {WebResourcesPluginInterface} from '../../types'

export default class OutputWebAccessibleResourcesFolder {
  private readonly manifestPath: string
  private readonly exclude?: string[]

  constructor(options: WebResourcesPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  private getContentScriptsCss() {
    const manifestScripts = manifestFields(this.manifestPath).scripts
    const contentScriptsEntries = Object.entries(manifestScripts)
    const contentScripts = contentScriptsEntries.filter(([key]) => {
      return key.startsWith('content_scripts')
    })
    const contentScriptsCss = contentScripts.filter(([key]) => {
      return (
        key.endsWith('.css') ||
        key.endsWith('.scss') ||
        key.endsWith('.sass') ||
        key.endsWith('.less')
      )
    })

    return contentScriptsCss
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.emit.tapAsync('WebResourcesPlugin', (compilation, done) => {
      const {web_accessible_resources} = manifestFields(this.manifestPath)
      const contentScriptsCss = this.getContentScriptsCss()

      if (web_accessible_resources?.length) {
        for (const resource of web_accessible_resources) {
          // Manifest V2
          if (typeof resource === 'string') {
            const isContentCss = contentScriptsCss?.some(
              ([key]) => key === resource
            )

            if (!isContentCss) {
              if (!shouldExclude(this.manifestPath, resource, this.exclude)) {
                compilation.assets[`web_accessible_resources/${resource}`] =
                  compilation.assets[resource]
              }
            }
          } else {
            // Manifest V3
            resource.forEach((resourcePath, index) => {
              const isContentCss = contentScriptsCss?.some(
                ([key]) => key === resourcePath
              )

              if (!isContentCss) {
                if (
                  !shouldExclude(this.manifestPath, resourcePath, this.exclude)
                ) {
                  compilation.assets[
                    `web_accessible_resources/resource-${index}/${resourcePath}`
                  ] = compilation.assets[resourcePath]
                }
              }
            })
          }
        }
      }

      done()
    })
  }
}
