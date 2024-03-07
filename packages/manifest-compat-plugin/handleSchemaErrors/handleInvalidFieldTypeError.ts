import {WebpackError, Compilation} from 'webpack'
import {ErrorObject} from 'ajv'
import {bold, yellow, cyan} from '@colors/colors'
import {getManifestDocumentationURL} from '../helpers/getDocUrl'

export function invalidFieldType(
  errorData: ErrorObject | undefined,
  browser: string
) {
  const field = errorData?.instancePath.replaceAll('/', '.').slice(1) || ''
  const type = errorData?.params.type
  const namespace = yellow(field?.split('.')[0] || '')

  return `Field ${yellow(field)} must be of type ${cyan(type)}.

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
}

export default function handleInvalidFieldTypeError(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: string
) {
  compilation.errors.push(
    new WebpackError(
      bold(`[manifest.json]: ${invalidFieldType(errorData, browser)}`)
    )
  )
}
