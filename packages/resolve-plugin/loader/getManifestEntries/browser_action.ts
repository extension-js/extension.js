import * as path from '../../helpers/pathUtils.js'

import {type ManifestData} from './types.js'

export default function action(manifest: ManifestData) {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_popup
  ) {
    return undefined
  }

  const browserActionPage = manifest.browser_action.default_popup

  const browserActionPageAbsolutePath = browserActionPage

  return browserActionPageAbsolutePath
}
