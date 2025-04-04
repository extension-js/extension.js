import path from 'path'
import fs from 'fs'
import {Manifest} from '../../types'

export function isContentScriptEntry(
  absolutePath: string,
  manifestPath: string
): boolean {
  if (!absolutePath || !manifestPath) {
    return false
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  for (const content of manifest.content_scripts || []) {
    if (content.js?.length) {
      for (const js of content.js) {
        const contentPath = path.resolve(path.dirname(manifestPath), js)
        if (contentPath === absolutePath) {
          return true
        }
      }
    }
  }

  return false
}
