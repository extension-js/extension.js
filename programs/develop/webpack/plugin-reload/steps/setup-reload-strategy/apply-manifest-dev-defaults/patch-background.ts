import {DevOptions} from '../../../../../module'
import {Manifest} from '../../../../webpack-types'
export default function patchBackground(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  if (!manifest.background) {
    if (browser === 'firefox') {
      return {
        background: {
          ...(manifest.background || {}),
          scripts: ['background/script.js']
        }
      }
    }

    if (manifest.manifest_version === 2) {
      return {
        background: {
          ...(manifest.background || {}),
          scripts: ['background/script.js']
        }
      }
    }

    return {
      background: {
        ...(manifest.background || {}),
        service_worker: 'background/service_worker.js'
      }
    }
  }

  return {
    background: {
      ...manifest.background
    }
  }
}
