import path from 'path'
import fs from 'fs'
import {Compilation, WebpackError} from '@rspack/core'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function noDefaultLocaleError(
  manifest: Manifest,
  compilation: Compilation
) {
  // Check if a top-level _locales directory exists.
  const localesDir = path.join(compilation.options.context || '', '_locales')
  const manifestName = manifest.name || 'Extension.js'

  if (fs.existsSync(localesDir) && !manifest.default_locale) {
    return new WebpackError(messages.noDefaultLocaleError(manifestName))
  }

  return null
}
