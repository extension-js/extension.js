import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function sidebarAction(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (
    !manifest ||
    !manifest.sidebar_action ||
    !manifest.sidebar_action.default_panel
  ) {
    return undefined
  }

  const sidebarPage: string = manifest.sidebar_action.default_panel

  const sidebarPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    sidebarPage
  )

  return getHtmlResources(sidebarPageAbsolutePath)
}
