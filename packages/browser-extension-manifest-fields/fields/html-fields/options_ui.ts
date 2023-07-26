import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type ManifestData} from '../../types'

export default function optionsUi(
  manifestPath: string,
  manifest: ManifestData
) {
  if (manifest.options_page) {
    const optionsPage = manifest.options_page

    const optionsPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      optionsPage
    )

    return getHtmlResources(optionsPageAbsolutePath)
  }

  if (!manifest || !manifest.options_ui || !manifest.options_ui.page) {
    return undefined
  }

  const optionsPage = manifest.options_ui.page

  const optionsPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    optionsPage
  )

  return getHtmlResources(optionsPageAbsolutePath)
}
