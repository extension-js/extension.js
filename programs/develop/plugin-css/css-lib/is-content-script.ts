//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import {canonicalizeDir, toResourceKey} from '../../lib/resource-path'
import type {Manifest} from '../../types'

interface ContentScriptIndex {
  mtimeMs: number
  scriptsDir: string
  contentPaths: Set<string>
}

// Wired as a webpack issuer predicate (hot path): cache the derived
// content-script path set and rebuild only when the manifest mtime changes.
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

  // rspack hands the issuer predicate a symlink-resolved path, so a key
  // built from the manifest path as given never matches under a symlinked
  // project dir (macOS tmpdir included). Same helper on both sides.
  for (const content of manifest.content_scripts || []) {
    if (content.js?.length) {
      for (const js of content.js) {
        contentPaths.add(toResourceKey(path.resolve(manifestDir, js)))
      }
    }
  }

  const index: ContentScriptIndex = {
    mtimeMs,
    scriptsDir: canonicalizeDir(path.resolve(projectPath, 'scripts')),
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
  const absPathNormalized = toResourceKey(absolutePath)

  // Files inside <projectPath>/scripts are treated as content-script-like
  const relToScripts = path.relative(scriptsDir, absPathNormalized)
  const isScriptsFolderScript =
    relToScripts &&
    !relToScripts.startsWith('..') &&
    !path.isAbsolute(relToScripts)

  if (isScriptsFolderScript) return true

  return contentPaths.has(absPathNormalized)
}
