import {fileURLToPath} from 'url'
import path from 'path'

export function getDirname(importMetaUrl: string) {
  const __filename = fileURLToPath(importMetaUrl)
  return path.dirname(__filename)
}
