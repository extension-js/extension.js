import path from 'path'
import fs from 'fs'
import rspack, {type Compilation} from '@rspack/core'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function noDefaultLocaleError(
  manifest: Manifest,
  compilation: Compilation
) {
  // Check if a top-level _locales directory exists.
  const localesDir = path.join(compilation.options.context || '', '_locales')

  if (fs.existsSync(localesDir) && !manifest.default_locale) {
    return new rspack.WebpackError(messages.noDefaultLocaleError())
  }

  return null
}
