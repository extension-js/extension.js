import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function optionsUi(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.options_ui && {
      options_ui: {
        ...manifest.options_ui,
        ...(manifest.options_ui.page && {
          page: getFilename('options_ui', manifest.options_ui.page, exclude)
        })
      }
    }
  )
}
