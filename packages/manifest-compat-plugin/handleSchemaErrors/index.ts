import {type Compilation} from 'webpack'
import Ajv from 'ajv'
import v3Schema from './lib/manifest.schema.v3.json'
import addCustomFormats from './lib/customValidators'
import handleRequiredFieldError from './handleRequiredFieldError'
import handleInvalidFieldTypeError from './handleInvalidFieldTypeError'
import handleDeprecatedError from './handleDeprecatedError'
import {ManifestBase} from '../manifest-types'

export default function handleSchemaErrors(
  compilation: Compilation,
  manifest: ManifestBase,
  browser: string
) {
  const ajv = new Ajv()
  addCustomFormats(ajv)

  const combinedSchema = {
    allOf: [v3Schema]
  }

  const validate = ajv.compile(combinedSchema)
  const valid = validate(manifest)
  const isManifestV3 = manifest.manifest_version === 3

  if (!valid) {
    if (validate.errors) {
      const errorData = validate.errors[0]

      if (errorData?.keyword === 'required') {
        handleRequiredFieldError(compilation, errorData, browser)
        return
      }

      if (isManifestV3) {
        if (errorData?.keyword === 'type') {
          handleInvalidFieldTypeError(compilation, errorData, browser)
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
