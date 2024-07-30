import {WebpackError, type Compilation} from 'webpack'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'

export function requiredFieldErrors(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: string
) {
  const missingProperty = errorData?.params.missingProperty as string
  compilation.errors.push(
    new WebpackError(messages.missingRequiredMessage(browser, missingProperty))
  )
}
