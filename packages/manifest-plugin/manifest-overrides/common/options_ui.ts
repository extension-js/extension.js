import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

export default function optionsUi(manifest: Manifest, exclude: string[]) {
  return (
    manifest.options_ui && {
      options_ui: {
        ...manifest.options_ui,
        ...(manifest.options_ui.page && {
          page: getFilename(
            'options_ui/page.html',
            manifest.options_ui.page,
            exclude
          )
        })
      }
    }
  )
}
