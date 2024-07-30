import webpack from 'webpack'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../types'

export function firefoxRunningServiceWorkerError(
  manifest: Manifest,
  browser: string
): webpack.WebpackError | null {
  if (browser === 'firefox') {
    if (manifest.background?.service_worker) {
      return new webpack.WebpackError(messages.firefoxServiceWorkerError())
    }
  }

  return null
}
