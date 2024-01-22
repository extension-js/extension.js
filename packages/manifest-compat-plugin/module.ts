import Ajv from 'ajv'
import fs from 'fs'
import path from 'path'
import {Compiler, WebpackError} from 'webpack'
import v2Schema from 'chrome-extension-manifest-json-schema/manifest/manifest.schema.v2.json'
import v3Schema from 'chrome-extension-manifest-json-schema/manifest/manifest.schema.v3.json'
import addCustomFormats from './src/helpers/customValidators'

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
      'ValidateManifestPlugin',
      (compilation, done) => {
        const manifestPath = path.resolve(
          compiler.options.context!,
          this.options.manifestPath
        )
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

        const ajv = new Ajv()
        addCustomFormats(ajv)

        let schema
        if (manifest.manifest_version === 2) {
          schema = v2Schema
        } else if (manifest.manifest_version === 3) {
          schema = v3Schema
        } else {
          compilation.warnings.push(
            new WebpackError('Unsupported manifest version')
          )
          return done()
        }

        const validate = ajv.compile(schema)
        const valid = validate(manifest)

        if (!valid) {
          compilation.warnings.push(
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
