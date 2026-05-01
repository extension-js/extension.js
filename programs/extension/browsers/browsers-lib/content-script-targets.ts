// Content script target matching and resolution utilities.
// Adapted from develop's plugin-browsers version — rspack-coupled functions
// (collectContentScriptDependencyPaths) are omitted; they live in
// BrowsersPlugin which has access to the real Compilation.

import * as fs from 'fs'
import * as path from 'path'
import type {CompilationLike} from '../browsers-types'
import {
  CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX,
  getCanonicalContentScriptEntryName
} from './content-script-contracts'

export type ContentScriptTargetRule = {
  index: number
  world: 'extension' | 'main'
  matches: string[]
  excludeMatches: string[]
  includeGlobs: string[]
  excludeGlobs: string[]
}

type ManifestLike = {
  content_scripts?: Array<{
    world?: string
    matches?: string[]
    exclude_matches?: string[]
    include_globs?: string[]
    exclude_globs?: string[]
    js?: string[]
    css?: string[]
  }>
}

// Inline contract helpers (from develop's feature-scripts/contracts)
function isCanonicalContentScriptEntryName(entryName: string): boolean {
  return (
    typeof entryName === 'string' &&
    entryName.startsWith(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX)
  )
}

function isCanonicalContentScriptAssetImpl(assetName: string): boolean {
  if (typeof assetName !== 'string') return false
  const base = assetName.replace(/\.[a-f0-9]+\.(js|css)$/i, '.$1')
  return (
    base.startsWith(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX) &&
    /\.(js|css)$/.test(base)
  )
}

export function parseCanonicalContentScriptEntryIndex(
  entryName: string
): number | undefined {
  if (typeof entryName !== 'string') return undefined

  const base = entryName
    .replace(/\.[a-f0-9]+\.(js|css)$/i, '')
    .replace(/\.(js|css)$/i, '')
  if (!base.startsWith(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX)) return undefined

  const suffix = base.slice(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX.length)
  // Guard against empty / non-numeric suffixes — `Number("")` is 0, which
  // would silently match `content_scripts/content-` and other malformed names.
  if (!/^\d+$/.test(suffix)) return undefined
  const index = Number(suffix)
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

function getCanonicalContentScriptJsAssetName(index: number): string {
  return `${getCanonicalContentScriptEntryName(index)}.js`
}

function getCanonicalContentScriptCssAssetName(index: number): string {
  return `${getCanonicalContentScriptEntryName(index)}.css`
}

export function isContentScriptEntryName(entryName: string): boolean {
  return isCanonicalContentScriptEntryName(entryName)
}

export function isCanonicalContentScriptAsset(assetName: string): boolean {
  return isCanonicalContentScriptAssetImpl(assetName)
}

/**
 * Resolves the on-disk file for a canonical content bundle. In development the
 * emitted name may include a fullhash (e.g. content_scripts/content-0.a1b2c3d4.js).
 *
 * Dev mode runs with `output.clean: false`, so successive rebuilds leave old
 * hashed bundles on disk for the same `content-<index>` entry. Returning the
 * first `readdirSync` match would pick a stale bundle whenever the filesystem
 * order doesn't align with write order — and Firefox / Chromium would then
 * `executeScript` an outdated content script, making reload look unreliable.
 * Pick the most recently written match instead so the live reload always
 * reflects the latest rebuild.
 */
export function resolveEmittedContentScriptFile(
  extensionOutPath: string,
  index: number,
  ext: 'js' | 'css'
): string | null {
  const rel =
    ext === 'js'
      ? getCanonicalContentScriptJsAssetName(index)
      : getCanonicalContentScriptCssAssetName(index)
  const canonical = path.join(extensionOutPath, rel)
  if (fs.existsSync(canonical)) return canonical

  const dir = path.join(extensionOutPath, 'content_scripts')
  if (!fs.existsSync(dir)) return null
  try {
    const re = new RegExp(`^content-${index}\\.[a-f0-9]+\\.${ext}$`, 'i')
    let latestPath: string | null = null
    let latestMtimeMs = -Infinity

    for (const name of fs.readdirSync(dir)) {
      if (!re.test(name)) continue

      const candidate = path.join(dir, name)

      try {
        const stat = fs.statSync(candidate)

        if (stat.mtimeMs > latestMtimeMs) {
          latestMtimeMs = stat.mtimeMs
          latestPath = candidate
        }
      } catch {
        // Skip unreadable entries; another match may still resolve.
      }
    }
    return latestPath
  } catch {
    return null
  }
}

export function getChangedContentScriptEntryNames(
  modifiedFilePaths: string[],
  dependencyPathsByEntry: Map<string, Set<string>>
): string[] {
  const changed = new Set<string>()

  for (const rawModified of modifiedFilePaths) {
    const modifiedFilePath =
      normalizeModuleResourcePath(rawModified) ??
      String(rawModified || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .trim()
    if (!modifiedFilePath) continue

    for (const [
      entryName,
      dependencyPaths
    ] of dependencyPathsByEntry.entries()) {
      if (dependencyPaths.has(modifiedFilePath)) {
        changed.add(entryName)
        continue
      }

      for (const dependencyPath of dependencyPaths) {
        if (modifiedFilePath.endsWith(dependencyPath)) {
          changed.add(entryName)
          break
        }
      }
    }
  }

  return Array.from(changed).sort()
}

export function normalizeModuleResourcePath(
  resourcePath: unknown
): string | undefined {
  if (typeof resourcePath !== 'string' || resourcePath.length === 0) {
    return undefined
  }

  let normalized = resourcePath.replace(/\\/g, '/').trim()
  const urlWithAuthority =
    /^(?![A-Za-z]:\/)([a-z][a-z0-9+.-]*:)(\/\/)(.*)$/i.exec(normalized)
  if (urlWithAuthority) {
    normalized =
      urlWithAuthority[1] +
      urlWithAuthority[2] +
      urlWithAuthority[3].replace(/\/+/g, '/')
  } else {
    normalized = normalized.replace(/\/+/g, '/')
  }
  if (!normalized) return undefined

  const loaderIndex = normalized.lastIndexOf('!')
  if (loaderIndex >= 0) {
    normalized = normalized.slice(loaderIndex + 1)
  }

  const queryIndex = normalized.search(/[?#]/)
  if (queryIndex >= 0) {
    normalized = normalized.slice(0, queryIndex)
  }

  normalized = normalized.trim()
  return normalized || undefined
}

export function readContentScriptRules(
  compilation: CompilationLike,
  extensionRoot?: string
): ContentScriptTargetRule[] {
  const manifest =
    readManifestFromCompilation(compilation) ||
    readManifestFromDisk(extensionRoot) ||
    {}

  return getContentScriptRulesFromManifest(manifest)
}

export function getContentScriptRulesFromManifest(
  manifest: ManifestLike
): ContentScriptTargetRule[] {
  const contentScripts = Array.isArray(manifest?.content_scripts)
    ? manifest.content_scripts
    : []

  return contentScripts.map((contentScript, arrayIndex) => ({
    // `index` must match the canonical bundle index baked into the emitted
    // `content_scripts/content-N.js` filename so downstream file resolvers
    // pick the right bundle. That's NOT the manifest array position — MAIN
    // world bridges push entries into the manifest at positions whose
    // canonical bundle index is higher (e.g. entry at position 3 may be the
    // bridge with js=content-9.js). Parse the index from the actual js path.
    index: resolveCanonicalIndexFromEntry(contentScript) ?? arrayIndex,
    world: contentScript?.world === 'MAIN' ? 'main' : 'extension',
    matches: normalizeStringArray(contentScript?.matches),
    excludeMatches: normalizeStringArray(contentScript?.exclude_matches),
    includeGlobs: normalizeStringArray(contentScript?.include_globs),
    excludeGlobs: normalizeStringArray(contentScript?.exclude_globs)
  }))
}

type ManifestContentScriptEntry = {
  js?: unknown
  css?: unknown
}

function resolveCanonicalIndexFromEntry(
  entry: ManifestContentScriptEntry | undefined | null
): number | undefined {
  const js = Array.isArray(entry?.js) ? (entry as {js: unknown[]}).js : []

  for (const rawPath of js) {
    if (typeof rawPath !== 'string') continue
    const parsed = parseCanonicalAssetPath(rawPath, 'js')
    if (parsed !== undefined) return parsed
  }

  const css = Array.isArray(entry?.css) ? (entry as {css: unknown[]}).css : []

  for (const rawPath of css) {
    if (typeof rawPath !== 'string') continue
    const parsed = parseCanonicalAssetPath(rawPath, 'css')
    if (parsed !== undefined) return parsed
  }

  return undefined
}

function parseCanonicalAssetPath(
  assetPath: string,
  ext: 'js' | 'css'
): number | undefined {
  // content_scripts/content-<N>.js                     (stable)
  // content_scripts/content-<N>.<hash>.js              (dev, hashed)
  const match = new RegExp(
    `^content_scripts\\/content-(\\d+)(?:\\.[a-f0-9]+)?\\.${ext}$`,
    'i'
  ).exec(assetPath)

  if (!match) return undefined
  const index = Number(match[1])

  return Number.isInteger(index) && index >= 0 ? index : undefined
}

export function selectContentScriptRules(
  rules: ContentScriptTargetRule[],
  entryNames: string[]
): ContentScriptTargetRule[] {
  const selectedIndices = new Set<number>()

  for (const entryName of entryNames) {
    const index = parseCanonicalContentScriptEntryIndex(entryName)
    if (index === undefined) continue
    selectedIndices.add(index)
  }

  return rules.filter((rule) => selectedIndices.has(rule.index))
}

export function urlMatchesContentScriptRule(
  rawUrl: string,
  rule: ContentScriptTargetRule
): boolean {
  const url = safeParseUrl(rawUrl)
  if (!url) return false

  const hasPositiveMatch =
    rule.matches.some((pattern) => urlMatchesPattern(url, pattern)) &&
    (rule.includeGlobs.length === 0 ||
      rule.includeGlobs.some((glob) => urlMatchesGlob(rawUrl, glob)))

  if (!hasPositiveMatch) return false

  if (rule.excludeMatches.some((pattern) => urlMatchesPattern(url, pattern))) {
    return false
  }

  if (rule.excludeGlobs.some((glob) => urlMatchesGlob(rawUrl, glob))) {
    return false
  }

  return true
}

export function urlMatchesAnyContentScriptRule(
  rawUrl: string,
  rules: ContentScriptTargetRule[]
): boolean {
  return rules.some((rule) => urlMatchesContentScriptRule(rawUrl, rule))
}

function readManifestFromCompilation(
  compilation: CompilationLike
): ManifestLike | undefined {
  try {
    const asset = compilation.getAsset?.('manifest.json')
    if (!asset?.source) return undefined
    return JSON.parse(String(asset.source.source()))
  } catch {
    return undefined
  }
}

function readManifestFromDisk(
  extensionRoot?: string
): ManifestLike | undefined {
  if (!extensionRoot) return undefined

  try {
    const manifestPath = path.join(extensionRoot, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return undefined
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return undefined
  }
}

function normalizeStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    : []
}

function safeParseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

function urlMatchesPattern(url: URL, pattern: string): boolean {
  if (!pattern) return false

  if (pattern === '<all_urls>') {
    return /^(https?|file|ftp|ws|wss):$/i.test(url.protocol)
  }

  const parsedPattern = parseMatchPattern(pattern)
  if (!parsedPattern) return false

  if (!schemeMatches(url, parsedPattern.scheme)) return false
  if (!hostMatches(url, parsedPattern.host)) return false

  const urlPath = `${url.pathname}${url.search}${url.hash}`
  return wildcardToRegExp(parsedPattern.path).test(urlPath)
}

function parseMatchPattern(
  pattern: string
): {scheme: string; host: string; path: string} | undefined {
  const match = /^(\*|http|https|file|ftp|ws|wss):\/\/([^/]*)(\/.*)$/.exec(
    pattern
  )

  if (!match) return undefined

  return {
    scheme: match[1],
    host: match[2],
    path: match[3]
  }
}

function schemeMatches(url: URL, scheme: string): boolean {
  const protocol = url.protocol.replace(/:$/, '')
  if (scheme === '*') return protocol === 'http' || protocol === 'https'
  return protocol === scheme
}

function hostMatches(url: URL, hostPattern: string): boolean {
  if (hostPattern === '*') return true
  if (url.protocol === 'file:') return hostPattern === '' || hostPattern === '*'

  const hostname = url.hostname
  if (!hostname) return false

  if (hostPattern.startsWith('*.')) {
    const bareHost = hostPattern.slice(2)
    return hostname === bareHost || hostname.endsWith(`.${bareHost}`)
  }

  return hostname === hostPattern
}

function urlMatchesGlob(rawUrl: string, glob: string): boolean {
  return wildcardToRegExp(glob).test(rawUrl)
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
}
