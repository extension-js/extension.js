import * as fs from 'fs'
import * as path from 'path'
import type {Compilation} from '@rspack/core'
import {
  isCanonicalContentScriptEntryName,
  isCanonicalContentScriptAsset as isFeatureScriptsCanonicalContentScriptAsset,
  parseCanonicalContentScriptEntryIndex,
  getCanonicalContentScriptCssAssetName,
  getCanonicalContentScriptJsAssetName
} from '../../plugin-web-extension/feature-scripts/contracts'

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
  }>
}

export function isContentScriptEntryName(entryName: string): boolean {
  return isCanonicalContentScriptEntryName(entryName)
}

export function isCanonicalContentScriptAsset(assetName: string): boolean {
  return isFeatureScriptsCanonicalContentScriptAsset(assetName)
}

/**
 * Resolves the on-disk file for a canonical content bundle. In development the
 * emitted name may include a fullhash (e.g. content_scripts/content-0.a1b2c3d4.js).
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
    let best: string | null = null
    let bestMtime = 0
    for (const name of fs.readdirSync(dir)) {
      if (!re.test(name)) continue
      const full = path.join(dir, name)
      try {
        const mt = fs.statSync(full).mtimeMs
        if (mt > bestMtime) {
          bestMtime = mt
          best = full
        }
      } catch {
        if (!best) best = full
      }
    }
    return best
  } catch {
    return null
  }
}

export function getChangedContentScriptEntryNames(
  modifiedFilePaths: string[],
  dependencyPathsByEntry: Map<string, Set<string>>
): string[] {
  const changed = new Set<string>()

  for (const modifiedFilePath of modifiedFilePaths) {
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

export function collectContentScriptDependencyPaths(
  compilation: Compilation
): Map<string, Set<string>> {
  const dependencyPathsByEntry = new Map<string, Set<string>>()
  const entrypoints: Map<string, any> | undefined = (compilation as any)
    ?.entrypoints
  const chunkGraph: any = (compilation as any)?.chunkGraph

  if (!entrypoints || !chunkGraph) {
    return dependencyPathsByEntry
  }

  for (const [entryName, entrypoint] of entrypoints.entries()) {
    if (!isContentScriptEntryName(entryName)) continue

    const resourcePaths = new Set<string>()
    const entrypointChunks: any[] = Array.from(
      (entrypoint as any)?.chunks || []
    )

    for (const chunk of entrypointChunks) {
      const modulesIterable: Iterable<any> | undefined =
        chunkGraph.getChunkModulesIterable?.(chunk) ||
        chunkGraph.getChunkModulesIterableBySourceType?.(chunk, 'javascript') ||
        chunkGraph.getChunkModules?.(chunk)

      if (!modulesIterable) continue

      for (const module of modulesIterable as any) {
        collectModuleResourcePaths(module, resourcePaths)
      }
    }

    collectDeclaredEntryImportPaths(compilation, entryName, resourcePaths)
    collectTransitiveLocalDependencyPaths(resourcePaths)

    if (resourcePaths.size > 0) {
      dependencyPathsByEntry.set(entryName, resourcePaths)
    }
  }

  return dependencyPathsByEntry
}

function collectModuleResourcePaths(
  module: any,
  resourcePaths: Set<string>,
  seen = new Set<any>()
) {
  if (!module || seen.has(module)) return
  seen.add(module)

  const candidateResourcePaths: unknown[] = [
    module?.resource,
    module?.rootModule?.resource,
    module?.originalSource?.()?.resource
  ]

  for (const resourcePath of candidateResourcePaths) {
    const normalizedResourcePath = normalizeModuleResourcePath(resourcePath)
    if (normalizedResourcePath) {
      resourcePaths.add(normalizedResourcePath)
    }
  }

  const nestedCollections = [
    module?.modules,
    module?._modules,
    module?.children,
    module?.dependencies
  ]

  for (const nestedCollection of nestedCollections) {
    if (!nestedCollection) continue
    for (const nestedModule of nestedCollection as Iterable<any>) {
      collectModuleResourcePaths(nestedModule, resourcePaths, seen)
    }
  }
}

function collectDeclaredEntryImportPaths(
  compilation: Compilation,
  entryName: string,
  resourcePaths: Set<string>
) {
  const rawEntry = (compilation as any)?.options?.entry?.[entryName]
  const importSpecifiers = normalizeEntryImportSpecifiers(rawEntry)
  for (const importSpecifier of importSpecifiers) {
    const normalizedImportPath = normalizeModuleResourcePath(importSpecifier)
    if (normalizedImportPath && fs.existsSync(normalizedImportPath)) {
      resourcePaths.add(normalizedImportPath)
      continue
    }

    const dataUrlSource = decodeJavascriptDataUrl(importSpecifier)
    if (!dataUrlSource) continue

    for (const referencedPath of extractReferencedSourcePaths(dataUrlSource)) {
      resourcePaths.add(referencedPath)
    }
  }
}

function normalizeEntryImportSpecifiers(rawEntry: any): string[] {
  if (!rawEntry) return []
  if (typeof rawEntry === 'string') return [rawEntry]
  if (Array.isArray(rawEntry))
    return rawEntry.map((value) => String(value || ''))

  const entryImport = rawEntry?.import
  if (typeof entryImport === 'string') return [entryImport]
  if (Array.isArray(entryImport)) {
    return entryImport.map((value) => String(value || ''))
  }

  return []
}

function decodeJavascriptDataUrl(specifier: string): string | undefined {
  const value = String(specifier || '')
  if (!value.startsWith('data:text/javascript')) return undefined
  const commaIndex = value.indexOf(',')
  if (commaIndex === -1) return undefined
  try {
    return decodeURIComponent(value.slice(commaIndex + 1))
  } catch {
    return undefined
  }
}

function extractReferencedSourcePaths(source: string): string[] {
  const referencedPaths = new Set<string>()
  const patterns = [
    /\bimport\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+[^"'`]*?\s+from\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      const normalizedResourcePath = normalizeModuleResourcePath(match[1])
      if (normalizedResourcePath && fs.existsSync(normalizedResourcePath)) {
        referencedPaths.add(normalizedResourcePath)
      }
    }
  }

  return Array.from(referencedPaths)
}

function collectTransitiveLocalDependencyPaths(resourcePaths: Set<string>) {
  const queue = Array.from(resourcePaths)
  const seenFiles = new Set<string>(queue)

  while (queue.length > 0) {
    const currentPath = queue.shift()
    if (!currentPath || !fs.existsSync(currentPath)) continue

    let stat: fs.Stats
    try {
      stat = fs.statSync(currentPath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    let source = ''
    try {
      source = fs.readFileSync(currentPath, 'utf8')
    } catch {
      continue
    }

    for (const dependencyPath of resolveLocalSourceDependencies(
      currentPath,
      source
    )) {
      if (seenFiles.has(dependencyPath)) continue
      seenFiles.add(dependencyPath)
      resourcePaths.add(dependencyPath)
      queue.push(dependencyPath)
    }
  }
}

function resolveLocalSourceDependencies(
  absoluteFilePath: string,
  source: string
): string[] {
  const resolvedPaths = new Set<string>()
  const patterns = [
    /\bimport\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+[^"'`]*?\s+from\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      const specifier = String(match[1] || '')
      if (
        !specifier ||
        (!specifier.startsWith('.') && !specifier.startsWith('/'))
      ) {
        continue
      }
      const resolvedPath = resolveLocalDependencyPath(
        absoluteFilePath,
        specifier
      )
      if (resolvedPath) {
        resolvedPaths.add(resolvedPath)
      }
    }
  }

  return Array.from(resolvedPaths)
}

function resolveLocalDependencyPath(
  absoluteFilePath: string,
  specifier: string
): string | undefined {
  const specifierWithoutQuery = String(specifier || '').replace(/[?#].*$/, '')
  if (!specifierWithoutQuery) return undefined

  const basePath = specifierWithoutQuery.startsWith('/')
    ? specifierWithoutQuery
    : path.resolve(path.dirname(absoluteFilePath), specifierWithoutQuery)

  const candidates = new Set<string>([basePath])
  const extensions = [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.css',
    '.scss',
    '.sass',
    '.less'
  ]

  for (const extension of extensions) {
    candidates.add(`${basePath}${extension}`)
    candidates.add(path.join(basePath, `index${extension}`))
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeModuleResourcePath(candidate)
    if (normalizedCandidate && fs.existsSync(normalizedCandidate)) {
      return normalizedCandidate
    }
  }

  return undefined
}

export function normalizeModuleResourcePath(
  resourcePath: unknown
): string | undefined {
  if (typeof resourcePath !== 'string' || resourcePath.length === 0) {
    return undefined
  }

  let normalized = resourcePath.replace(/\\/g, '/').trim()
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
  compilation: Compilation,
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

  return contentScripts.map((contentScript, index) => ({
    index,
    world: contentScript?.world === 'MAIN' ? 'main' : 'extension',
    matches: normalizeStringArray(contentScript?.matches),
    excludeMatches: normalizeStringArray(contentScript?.exclude_matches),
    includeGlobs: normalizeStringArray(contentScript?.include_globs),
    excludeGlobs: normalizeStringArray(contentScript?.exclude_globs)
  }))
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
  compilation: Compilation
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
