import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/utils'

// A DevTools extension adds functionality to the Chrome DevTools.
// It can add new UI panels and sidebars, interact with the
// inspected page, get information about network requests, and more.
export function devtoolsPage(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.devtools_page && {
      devtools_page: getFilename(
        'devtools/index.html',
        manifest.devtools_page,
        excludeList
      )
    }
  )
}
