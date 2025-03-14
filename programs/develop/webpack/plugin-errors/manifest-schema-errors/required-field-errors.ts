import {WebpackError, type Compilation} from '@rspack/core'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'
import {DevOptions} from '../../../module'

export function requiredFieldErrors(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: DevOptions['browser']
) {
  const missingProperty = errorData?.params.missingProperty as string
  compilation.errors.push(
    new WebpackError(messages.missingRequiredMessage(browser, missingProperty))
  )
}
