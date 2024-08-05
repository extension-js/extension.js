import path from 'path'
import fs from 'fs'
import webpack from 'webpack'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function noDefaultLocaleError(
  manifest: Manifest,
  compilation: webpack.Compilation
): webpack.WebpackError | null {
  // Check if a top-level _locales directory exists.
  const localesDir = path.join(compilation.options.context || '', '_locales')
  const manifestName = manifest.name || 'Extension.js'

  if (fs.existsSync(localesDir) && !manifest.default_locale) {
    return new webpack.WebpackError(messages.noDefaultLocaleError(manifestName))
  }

  return null
}
