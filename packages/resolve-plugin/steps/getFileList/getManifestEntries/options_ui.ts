import {type ManifestData} from './types.js'

export default function optionsUi(manifest: ManifestData) {
  if (manifest.options_page) {
    const optionsPage = manifest.options_page

    const optionsPageAbsolutePath = optionsPage

    return optionsPageAbsolutePath
  }

  if (!manifest || !manifest.options_ui || !manifest.options_ui.page) {
    return undefined
  }

  const optionsPage = manifest.options_ui.page

  const optionsPageAbsolutePath = optionsPage

  return optionsPageAbsolutePath
}
