import * as path from '../../helpers/pathUtils.js'

import {type ManifestData} from './types.js'

export default function pageAction(manifest: ManifestData) {
  if (
    !manifest ||
    !manifest.page_action ||
    !manifest.page_action.default_popup
  ) {
    return undefined
  }

  const pageActionPage = manifest.page_action.default_popup

  const pageActionPageAbsolutePath = pageActionPage

  return pageActionPageAbsolutePath
}
