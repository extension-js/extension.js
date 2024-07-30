import {WebpackError, type Compilation} from 'webpack'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'

export function invalidFieldTypeErrors(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: string
) {
  compilation.warnings.push(
    new WebpackError(messages.invalidFieldType(errorData, browser))
  )
}
