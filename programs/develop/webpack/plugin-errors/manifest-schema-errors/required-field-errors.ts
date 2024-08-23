import path from 'path'
import {WebpackError, type Compilation} from '@rspack/core'
import {type ErrorObject} from 'ajv'
import {type Manifest} from '../../webpack-types'
import * as messages from '../../lib/messages'
import {DevOptions} from '../../../module'

export function requiredFieldErrors(
  compilation: Compilation,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined,
  browser: DevOptions['browser']
) {
  const context = compilation.options.context || ''
  const manifestPath = path.join(context, 'manifest.json')
  const manifest: Manifest = require(manifestPath)
  const manifestName = manifest.name || 'Extension.js'

  const missingProperty = errorData?.params.missingProperty as string
  compilation.errors.push(
    new WebpackError(
      messages.missingRequiredMessage(manifestName, browser, missingProperty)
    )
  )
}
