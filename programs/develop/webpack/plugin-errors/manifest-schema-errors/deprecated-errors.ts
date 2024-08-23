import path from 'path'
import {WebpackError, type Compilation} from '@rspack/core'
import {type ErrorObject} from 'ajv'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'
import {DevOptions} from '../../../module'

export default function handleDeprecatedError(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: DevOptions['browser']
) {
  const context = compilation.options.context || ''
  const manifestPath = path.join(context, 'manifest.json')
  const manifest: Manifest = require(manifestPath)
  const manifestName = manifest.name || 'Extension.js'

  compilation.warnings.push(
    new WebpackError(
      messages.deprecatedMessage(manifestName, browser, errorData)
    )
  )
}
