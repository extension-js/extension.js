import {fileURLToPath} from 'url'
import path from 'path'

export function getDirname(importMetaUrl) {
  const filename = fileURLToPath(importMetaUrl)
  return path.dirname(filename)
}
