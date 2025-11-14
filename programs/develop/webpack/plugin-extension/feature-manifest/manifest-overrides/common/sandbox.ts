import {getFilename} from '../../manifest-lib/paths'
import {type Manifest} from '../../../../webpack-types'

// Defines an collection of app or extension pages that are to be served
// in a sandboxed unique origin, and optionally a Content Security Policy
// to use with them.
export function sandbox(manifest: Manifest) {
  return (
    manifest.sandbox && {
      sandbox: {
        ...manifest.sandbox,
        ...(manifest.sandbox.pages && {
          pages: manifest.sandbox.pages.map((page: string, index: number) => {
            return getFilename(`sandbox/page-${index}.html`, page)
          })
        })
      }
    }
  )
}
