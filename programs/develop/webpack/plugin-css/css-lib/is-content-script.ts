//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {Manifest} from '../../webpack-types'

function parseJsonSafe(text: string) {
  const s = text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return JSON.parse(s || '{}')
}

export function isContentScriptEntry(
  absolutePath: string,
  manifestPath: string
): boolean {
  if (!absolutePath || !manifestPath) {
    return false
  }
  if (!fs.existsSync(manifestPath)) return false

  const manifest: Manifest = parseJsonSafe(
    fs.readFileSync(manifestPath, 'utf8')
  )

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
