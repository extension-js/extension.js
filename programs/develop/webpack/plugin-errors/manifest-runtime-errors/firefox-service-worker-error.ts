import rspack from '@rspack/core'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function firefoxRunningServiceWorkerError(
  manifest: Manifest,
  browser: string
) {
  if (browser === 'firefox' || browser === 'gecko-based') {
    if (manifest.background?.service_worker) {
      return new rspack.WebpackError(messages.firefoxServiceWorkerError())
    }
  }

  return null
}
