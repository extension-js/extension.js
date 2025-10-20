import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../../develop-lib/utils'

// Defines an collection of app or extension pages that are to be served
// in a sandboxed unique origin, and optionally a Content Security Policy
// to use with them.
export function sandbox(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.sandbox && {
      sandbox: {
        ...manifest.sandbox,
        ...(manifest.sandbox.pages && {
          pages: manifest.sandbox.pages.map((page: string, index: number) => {
            return getFilename(`sandbox/page-${index}.html`, page, excludeList)
          })
        })
      }
    }
  )
}
