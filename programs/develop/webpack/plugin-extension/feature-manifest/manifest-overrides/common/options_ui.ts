import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

export function optionsUi(manifest: Manifest, exclude: string[]) {
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
