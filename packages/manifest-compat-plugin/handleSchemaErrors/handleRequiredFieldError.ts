import {WebpackError, type Compilation} from 'webpack'
import {type ErrorObject} from 'ajv'
import {yellow, bold} from '@colors/colors'
import {getManifestDocumentationURL} from '../helpers/getDocUrl'

function missingRequiredMessage(browser: string, message: string | undefined) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const namespace = yellow(message?.split('.')[0] || '')
  const errorMessage = `Field ${yellow(
    message || ''
  )} is required. ${hintMessage}

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
  return errorMessage
}

export default function handleRequiredFieldError(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: string
) {
  const missingProperty = errorData?.params.missingProperty as string
  compilation.errors.push(
    new WebpackError(
      `[manifest.json]: ${missingRequiredMessage(browser, missingProperty)}`
    )
  )
}
