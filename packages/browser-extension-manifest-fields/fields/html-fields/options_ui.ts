import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function optionsUi(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (manifest.options_page) {
    const optionsPage: string = manifest.options_page

    const optionsPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      optionsPage
    )

    return getHtmlResources(optionsPageAbsolutePath)
  }

  if (!manifest || !manifest.options_ui || !manifest.options_ui.page) {
    return undefined
  }

  const optionsPage: string = manifest.options_ui.page

  const optionsPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    optionsPage
  )

  return getHtmlResources(optionsPageAbsolutePath)
}
