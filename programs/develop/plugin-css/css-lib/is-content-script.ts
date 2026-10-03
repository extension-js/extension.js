//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import {canonicalizeDir, toResourceKey} from '../../lib/resource-path'
import {scriptsFolderRoot} from '../../plugin-special-folders/folders-config'
import type {DevOptions, Manifest} from '../../types'

interface ContentScriptIndex {
  mtimeMs: number
  scriptsDir: string | undefined
  contentPaths: Set<string>
}

// Wired as a webpack issuer predicate (hot path): cache the derived
// content-script path set and rebuild only when the manifest mtime changes.
const indexCache = new Map<string, ContentScriptIndex>()

function getContentScriptIndex(
  manifestPath: string,
  projectPath: string,
  browser: DevOptions['browser']
): ContentScriptIndex {
  // The browser belongs in the key: the same manifest resolves to a different
  // content-script set per target, and a shared key would serve a stale one.
  const scriptsRoot = scriptsFolderRoot(projectPath)
  const cacheKey = `${manifestPath}::${projectPath}::${browser}::${scriptsRoot}`

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

  // A content script declared as firefox:content_scripts is invisible to a
  // raw read, and its CSS then leaves through the page stylesheet rule.
  const manifest: Manifest = filterKeysForThisBrowser(
    parseJsonSafe(fs.readFileSync(manifestPath, 'utf8')),
    browser
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
    scriptsDir: scriptsRoot ? canonicalizeDir(scriptsRoot) : undefined,
    contentPaths
  }
  indexCache.set(cacheKey, index)

  return index
}

export function isContentScriptEntry(
  absolutePath: string,
  manifestPath: string,
  projectPath: string,
  browser: DevOptions['browser'] = 'chrome'
): boolean {
  if (!absolutePath || !manifestPath || !projectPath) {
    return false
  }

  if (!fs.existsSync(manifestPath)) return false

  const {scriptsDir, contentPaths} = getContentScriptIndex(
    manifestPath,
    projectPath,
    browser
  )
  const absPathNormalized = toResourceKey(absolutePath)

  // Files inside the scripts folder in use are content-script-like. The
  // `folders` config moves that folder or turns it off.
  const relToScripts = scriptsDir
    ? path.relative(scriptsDir, absPathNormalized)
    : ''
  const isScriptsFolderScript =
    relToScripts &&
    !relToScripts.startsWith('..') &&
    !path.isAbsolute(relToScripts)

  if (isScriptsFolderScript) return true

  return contentPaths.has(absPathNormalized)
}
