import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function pageAction(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (
    !manifest ||
    !manifest.page_action ||
    !manifest.page_action.default_popup
  ) {
    return undefined
  }

  const pageActionPage: string = manifest.page_action.default_popup

  const pageActionPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    pageActionPage
  )

  return getHtmlResources(pageActionPageAbsolutePath)
}
