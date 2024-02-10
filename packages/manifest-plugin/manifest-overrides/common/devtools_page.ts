import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

// A DevTools extension adds functionality to the Chrome DevTools.
// It can add new UI panels and sidebars, interact with the
// inspected page, get information about network requests, and more.
export default function devtoolsPage(manifest: Manifest, exclude: string[]) {
  return (
    manifest.devtools_page && {
      devtools_page: getFilename(
        'devtools_page.html',
        manifest.devtools_page,
        exclude
      )
    }
  )
}
