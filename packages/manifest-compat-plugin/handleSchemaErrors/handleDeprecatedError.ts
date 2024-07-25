import {WebpackError, type Compilation} from 'webpack'
import {type ErrorObject} from 'ajv'
import {yellow, bold} from '@colors/colors'
import {getManifestDocumentationURL} from '../helpers/getDocUrl'

function deprecatedMessage(
  browser: string,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined
) {
  const schemaPath = errorData?.schemaPath
  const splitSchemaPath = schemaPath?.split('/')
  const field = splitSchemaPath?.slice(splitSchemaPath.length - 2).shift()
  const hintMessage = `Update your ${yellow(
    'manifest.json'
  )} file to run your extension.`
  const namespace = yellow(field?.split('.')[0] || '')
  const errorMessage = `Field ${yellow(
    field || ''
  )} is deprecated in Manifest V3. ${hintMessage}

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
  return errorMessage
}

export default function handleDeprecatedError(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: string
) {
  compilation.warnings.push(
    new WebpackError(
      `[manifest.json]: ${deprecatedMessage(browser, errorData)}`
    )
  )
}
