import fs from 'fs'
import {type Compiler, type Compilation} from '@rspack/core'
import Ajv from 'ajv'
import v3Schema from './lib/manifest.schema.v3.json'
import {addCustomFormats} from './lib/custom-validators'
import {requiredFieldErrors} from './required-field-errors'
import {invalidFieldTypeErrors} from './invalid-field-type-errors'
import * as utils from '../../lib/utils'
import handleDeprecatedError from './deprecated-errors'
import {type PluginInterface, type Manifest} from '../../webpack-types'
import {DevOptions} from '../../../commands/commands-lib/config-types'

export class ManifestSchemaErrorsPlugin {
  private readonly options: PluginInterface

  constructor(options: PluginInterface) {
    this.options = options
  }

  handleSchemaErrors(
    compilation: Compilation,
    manifest: Manifest,
    browser: DevOptions['browser']
  ) {
    const ajv = new Ajv()
    addCustomFormats(ajv)

    const combinedSchema = {
      allOf: [v3Schema]
    }

    const validate = ajv.compile(combinedSchema)
    const patchedManifest = utils.filterKeysForThisBrowser(manifest, browser)
    const valid = validate(patchedManifest)
    const isManifestV3 = patchedManifest.manifest_version === 3

    if (!valid) {
      if (validate.errors) {
        const errorData = validate.errors[0]

        if (errorData?.keyword === 'required') {
          requiredFieldErrors(compilation, errorData, browser)
          return
        }

        if (isManifestV3) {
          if (errorData?.keyword === 'type') {
            invalidFieldTypeErrors(compilation, errorData, browser)
          }

          if (errorData?.keyword === 'not') {
            handleDeprecatedError(compilation, errorData, browser)
          }
        } else {
          // TODO
        }
      }
    }
  }

  apply(compiler: Compiler) {
    // When a manifest.json has fields that are not compatible with the browser they are targeting.
    // - A manifest field that has been deprecated in their manifest file version.
    // - A maniefst field has the wrong type, e.g. a string instead of an array.
    // - A manifest field that is required but missing.
    compiler.hooks.afterCompile.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        const manifestPath = this.options.manifestPath
        const manifest: Manifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        )
        const browser = this.options.browser || 'chrome'

        this.handleSchemaErrors(compilation, manifest, browser)

        done()
      }
    )
  }
}
