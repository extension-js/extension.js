import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

export default function optionsPage(manifest: Manifest, exclude: string[]) {
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
