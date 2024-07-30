import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

export function optionsPage(manifest: Manifest, exclude: string[]) {
  return (
    manifest.options_page && {
      options_page: getFilename(
        'options_ui/page.html',
        manifest.options_page,
        exclude
      )
    }
  )
}
