import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

// A DevTools extension adds functionality to the Chrome DevTools.
// It can add new UI panels and sidebars, interact with the
// inspected page, get information about network requests, and more.
export function devtoolsPage(manifest: Manifest) {
  return (
    manifest.devtools_page && {
      devtools_page: (() => {
        const raw = String(manifest.devtools_page)
        const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
        const target = isPublic
          ? normalizeManifestOutputPath(raw)
          : 'devtools/index.html'
        return getFilename(target, raw)
      })()
    }
  )
}
