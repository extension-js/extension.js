import Ajv from 'ajv'
import fs from 'fs'
import path from 'path'
import {Compiler, WebpackError} from 'webpack'
// import v2Schema from './lib/manifest.schema.v2.json'
import v3Schema from './lib/manifest.schema.v3.json'
import addCustomFormats from './src/helpers/customValidators'
// import bcd from '@mdn/browser-compat-data'

interface ManifestCompatPluginOptions {
  manifestPath: string
}

export default class ManifestCompatPlugin {
  private options: ManifestCompatPluginOptions

  constructor(options: ManifestCompatPluginOptions) {
    this.options = options
  }

  apply(compiler: Compiler) {
    compiler.hooks.emit.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        // const ext = bcd.webextensions.manifest
        // console.log({ext})

        const manifestPath = path.resolve(
          compiler.options.context!,
          this.options.manifestPath
        )
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

        const ajv = new Ajv()
        addCustomFormats(ajv)

        const combinedSchema = {
          allOf: [v3Schema]
        }

        const validate = ajv.compile(combinedSchema)
        const valid = validate(manifest)

        if (!valid) {
          compilation.errors.push(
            new WebpackError(
              'Manifest validation error: ' + ajv.errorsText(validate.errors)
            )
          )
        }

        done()
      }
    )
  }
}
