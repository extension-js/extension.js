import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function action(manifestPath: string, manifest: ManifestData) {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_popup
  ) {
    return undefined
  }

  const browserActionPage = manifest.browser_action.default_popup

  const browserActionPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    browserActionPage
  )

  return browserActionPageAbsolutePath
}
