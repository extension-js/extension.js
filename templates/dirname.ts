import {fileURLToPath} from 'url'
import * as path from 'path'

export function getDirname(importMetaUrl: string) {
  const __filename = fileURLToPath(importMetaUrl)
  return path.dirname(__filename)
}
