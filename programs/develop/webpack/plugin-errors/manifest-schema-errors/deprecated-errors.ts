import path from 'path'
import {WebpackError, type Compilation} from 'webpack'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'
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
