import {WebpackError, type Compilation} from '@rspack/core'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'
import {DevOptions} from '../../../module'

export default function handleDeprecatedError(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: DevOptions['browser']
) {
  compilation.warnings.push(
    new WebpackError(messages.deprecatedMessage(browser, errorData))
  )
}
