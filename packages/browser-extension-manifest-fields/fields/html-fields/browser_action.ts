import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function action(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (
    !manifest ||
    !manifest.browser_action ||
    !manifest.browser_action.default_popup
  ) {
    return undefined
  }

  const browserActionPage: string = manifest.browser_action.default_popup

  const browserActionPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    browserActionPage
  )

  return getHtmlResources(browserActionPageAbsolutePath)
}
