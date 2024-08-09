import webpack from 'webpack'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function firefoxRunningServiceWorkerError(
  manifest: Manifest,
  browser: string
): webpack.WebpackError | null {
  if (browser === 'firefox') {
    if (manifest.background?.service_worker) {
      const manifestName = manifest.name || 'Extension.js'
      return new webpack.WebpackError(
        messages.firefoxServiceWorkerError(manifestName)
      )
    }
  }

  return null
}
