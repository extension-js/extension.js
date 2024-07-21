import path from 'path'
import {type Manifest} from '../../../../types'

export function optionsUi(
  context: string,

  manifest: Manifest
): string | undefined {
  if (manifest.options_page) {
    const optionsPage: string = manifest.options_page

    return path.join(context, optionsPage)
  }

  if (!manifest || !manifest.options_ui || !manifest.options_ui.page) {
    return undefined
  }

  const optionsPage: string = manifest.options_ui.page

  return path.join(context, optionsPage)
}
