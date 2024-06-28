import fs from 'fs'
import {type Compiler} from 'webpack'
import {type ManifestCompatInterface} from './types'
import handleSchemaErrors from './handleSchemaErrors'
import handleRuntimeErrors from './handleRuntimeErrors'
import HandleBrowserSpecificFields from './plugins/HandleBrowserSpecificFields'
import {type ManifestBase} from './manifest-types'

export default class ManifestCompatPlugin {
  private readonly options: ManifestCompatInterface

  constructor(options: ManifestCompatInterface) {
    this.options = options
  }

  apply(compiler: Compiler) {
    // TODO: This should be split into multiple plugins
    // - HandleMissingFields - When users are missing a required field in their manifest file.
    // - HandleDeprecatedFields - When users use a manifest field that has been deprecated in their manifest file version.
    // - HandleV2ToV3Changes - When users use a manifest field that has changed from v2 to v3 e.g. `web_accessible_resources`.
    // - HandleFieldTypeMistakes - When users use a field with the wrong type, e.g. a string instead of an array.

    // - HandleBrowserSpecificFields - When users use non-compilant, browser-specific fields e.g. `chrome:`, `firefox:`.
    new HandleBrowserSpecificFields({
      manifestPath: this.options.manifestPath,
      browser: this.options.browser || 'chrome'
    }).apply(compiler)

    // - HandleBrowserCompatErrors - When users use a field that is not compatible with the browser they are targeting.
    // - HandleManifestVersionErrors - When users use a field that is not compatible with the browser they are targeting.

    // TODO: Refactor this
    compiler.hooks.afterCompile.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        const manifestPath = this.options.manifestPath
        const manifest: ManifestBase = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        )
        const browser = this.options.browser || 'chrome'

        handleSchemaErrors(compilation, manifest, browser)
        handleRuntimeErrors(compilation, manifest, browser)

        done()
      }
    )
  }
}
