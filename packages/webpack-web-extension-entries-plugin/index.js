const { Compilation } = require('webpack')
const modifyBackgroundScript = require('./background-modifier')

class WebpackWebExtensionManifestEntriesPlugin {
  constructor (manifest) {
    this.manifest = manifest
  }

  apply (compiler) {
    compiler.hooks.compilation.tap('ManifestEntriesPlugin', compilation => {
      const { background } = this.manifest
      let json = ''

      if (this.manifest) {
        json = {
          ...this.manifest,
          ...modifyBackgroundScript(background.scripts)
        }
      }

      compilation.hooks.processAssets.tap(
        {
          name: 'ManifestEntriesPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        (assets) => {
          const prettyJSON = JSON.stringify(json, null, 2)

          assets['manifest.json'] = {
            source: () => prettyJSON,
            size: () => prettyJSON.length
          }
        }
      )
    })
  }
}

module.exports = WebpackWebExtensionManifestEntriesPlugin
