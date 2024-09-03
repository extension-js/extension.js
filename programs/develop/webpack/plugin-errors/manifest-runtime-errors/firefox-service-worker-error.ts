import {WebpackError} from '@rspack/core'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function firefoxRunningServiceWorkerError(
  manifest: Manifest,
  browser: string
) {
  if (browser === 'firefox') {
    if (manifest.background?.service_worker) {
      const manifestName = manifest.name || 'Extension.js'
      return new WebpackError(messages.firefoxServiceWorkerError(manifestName))
    }
  }

  return null
}
