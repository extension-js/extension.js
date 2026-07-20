//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import type {Manifest} from '../../types'

interface ContentScriptIndex {
  mtimeMs: number
  scriptsDir: string
  contentPaths: Set<string>
}

// This function is wired as a webpack `issuer` predicate, so it runs once per
// module per CSS rule. Re-reading + re-parsing the manifest on every call is a
// real hot-path cost, so cache the derived content-script path set and only
// rebuild when the manifest's mtime changes (keeps watch-mode correctness)
const indexCache = new Map<string, ContentScriptIndex>()

function getContentScriptIndex(
  manifestPath: string,
  projectPath: string
): ContentScriptIndex {
  const cacheKey = `${manifestPath}::${projectPath}`

  let mtimeMs = -1
  try {
    mtimeMs = fs.statSync(manifestPath).mtimeMs
  } catch {
    // stat unavailable (e.g. mocked fs in tests), fall back to building once.
  }

  const cached = indexCache.get(cacheKey)
  if (cached && (mtimeMs < 0 || cached.mtimeMs === mtimeMs)) {
    return cached
  }

  const manifest: Manifest = parseJsonSafe(
    fs.readFileSync(manifestPath, 'utf8')
  )
  const manifestDir = path.dirname(manifestPath)
  const contentPaths = new Set<string>()

  for (const content of manifest.content_scripts || []) {
    if (content.js?.length) {
      for (const js of content.js) {
        contentPaths.add(path.resolve(manifestDir, js))
      }
    }
  }

  const index: ContentScriptIndex = {
    mtimeMs,
    scriptsDir: path.resolve(projectPath, 'scripts'),
    contentPaths
  }
  indexCache.set(cacheKey, index)
  return index
}

export function isContentScriptEntry(
  absolutePath: string,
  manifestPath: string,
  projectPath: string
): boolean {
  if (!absolutePath || !manifestPath || !projectPath) {
    return false
  }
  if (!fs.existsSync(manifestPath)) return false

  const {scriptsDir, contentPaths} = getContentScriptIndex(
    manifestPath,
    projectPath
  )
  const absPathNormalized = path.resolve(absolutePath)

  // Files inside <projectPath>/scripts are treated as content-script-like
  const relToScripts = path.relative(scriptsDir, absPathNormalized)
  const isScriptsFolderScript =
    relToScripts &&
    !relToScripts.startsWith('..') &&
    !path.isAbsolute(relToScripts)

  if (isScriptsFolderScript) return true

  return contentPaths.has(absPathNormalized)
}
