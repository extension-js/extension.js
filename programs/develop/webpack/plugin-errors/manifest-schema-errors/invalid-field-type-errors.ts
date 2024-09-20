import {WebpackError, type Compilation} from 'webpack'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'
import {DevOptions} from '../../../module'

export function invalidFieldTypeErrors(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: DevOptions['browser']
) {
  compilation.warnings.push(
    new WebpackError(messages.invalidFieldType(errorData, browser))
  )
}
