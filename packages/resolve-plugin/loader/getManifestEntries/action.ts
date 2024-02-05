import * as path from '../../helpers/pathUtils.js'

import {type ManifestData} from './types.js'

export default function action(manifest: ManifestData) {
  if (!manifest || !manifest.action || !manifest.action.default_popup) {
    return undefined
  }

  const actionPage = manifest.action.default_popup

  const actionPageAbsolutePath = actionPage

  return actionPageAbsolutePath
}
