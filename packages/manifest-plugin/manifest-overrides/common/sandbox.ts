import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

// Defines an collection of app or extension pages that are to be served
// in a sandboxed unique origin, and optionally a Content Security Policy
// to use with them.
export default function sandbox(manifest: Manifest, exclude: string[]) {
  return (
    manifest.sandbox && {
      sandbox: {
        ...manifest.sandbox,
        ...(manifest.sandbox.pages && {
          pages: manifest.sandbox.pages.map((page: string, index: number) => {
            return getFilename(`sandbox/page-${index}.html`, page, exclude)
          })
        })
      }
    }
  )
}
   