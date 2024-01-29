import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function pageAction(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.page_action ||
    !manifest.page_action.default_popup
  ) {
    return undefined
  }

  const pageActionPage = manifest.page_action.default_popup

  const pageActionPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    pageActionPage
  )

  return pageActionPageAbsolutePath
}
