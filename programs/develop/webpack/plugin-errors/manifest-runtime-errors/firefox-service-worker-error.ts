import webpack from 'webpack'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function firefoxRunningServiceWorkerError(
  manifest: Manifest,
  browser: string
): webpack.WebpackError | null {
  if (browser === 'firefox' || browser === 'gecko-based') {
    if (manifest.background?.service_worker) {
      return new webpack.WebpackError(messages.firefoxServiceWorkerError())
    }
  }

  return null
}
