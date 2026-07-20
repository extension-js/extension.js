// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripBom} from '../lib/parse-json-safe'
import {getCanonicalContentScriptEntryName} from '../plugin-web-extension/feature-scripts/contracts'

export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

export interface ReloadInstruction {
  // 'page' is notify-only: livereload refreshes the surface, but the signal
  // still travels the bridge so every announcing surface reflects it.
  type: ReloadType | 'page'
  changedContentScriptEntries?: string[]
  changedAssets?: string[]
  // Human context label shared VERBATIM by every announcing surface, so they
  // can never disagree. e.g. "content_script (content/scripts.tsx)".
  label?: string
}

/** "context (fileA, fileB +2 more)", the one label every reload surface shows. */
export function formatReloadContextLabel(
  context: string,
  files: string[]
): string {
  if (!files.length) return context
  const shown = files.slice(0, 2).join(', ')
  const extra = files.length > 2 ? ` +${files.length - 2} more` : ''
  return `${context} (${shown}${extra})`
}

// Best-effort page-context name for a page-only edit. Only used for the
// label, never for the reload decision.
export function pageContextFromSources(changedSources: string[]): string {
  const rules: Array<[RegExp, string]> = [
    [/(^|\/)(sidebar|side[-_]?panel)(\.|\/)/i, 'sidebar page'],
    [/(^|\/)(action|popup)(\.|\/)/i, 'popup page'],
    [/(^|\/)options(\.|\/)/i, 'options page'],
    [/(^|\/)devtools(\.|\/)/i, 'devtools page'],
    [/(^|\/)(newtab|new[-_]?tab)(\.|\/)/i, 'new tab page'],
    [/(^|\/)(history|bookmarks)(\.|\/)/i, 'page']
  ]
  for (const rel of changedSources) {
    for (const [re, name] of rules) {
      if (re.test(rel)) return name
    }
  }
  return 'page'
}

// Which dev-reload feature owns each source file, from the chunk graph.
// Name-pattern heuristics are NOT trustworthy for this decision.
export interface SourceFeatureIndex {
  swSources: Set<string>
  /** Source → canonical content_scripts entry names whose chunks contain it. */
  contentEntriesBySource: Map<string, Set<string>>
  pageSources: Set<string>
}

// Loader-prefixed module identifier to project-relative resource path(s).
// Classic-concat member files hide in the resource query; expand those too.
function moduleResourcesFromIdentifier(
  identifier: string,
  contextDir: string
): string[] {
  const afterLoaders = identifier.slice(identifier.lastIndexOf('!') + 1)
  // strip a trailing `|<layer>` marker (rspack appends the module layer)
  const noLayer = afterLoaders.split('|')[0]
  const queryIndex = noLayer.indexOf('?')
  const resourcePath =
    queryIndex === -1 ? noLayer : noLayer.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : noLayer.slice(queryIndex)

  const out: string[] = []
  const push = (absolute: string) => {
    if (!absolute || !path.isAbsolute(absolute)) return
    out.push(path.relative(contextDir, absolute).replace(/\\/g, '/'))
  }
  push(resourcePath)

  const concatMatch = query.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
  if (concatMatch) {
    try {
      const data = JSON.parse(decodeURIComponent(concatMatch[1]))
      for (const file of data?.js || []) push(String(file))
    } catch {
      // malformed query, the first file alone still classifies the entry
    }
  }
  return out
}

// Walk the finished compilation and record, for every bundled source file,
// which reload feature its chunks belong to. Nameless (async) chunks skipped.
export function buildSourceFeatureIndex(
  compilation: import('@rspack/core').Compilation,
  contextDir: string
): SourceFeatureIndex {
  const index: SourceFeatureIndex = {
    swSources: new Set(),
    contentEntriesBySource: new Map(),
    pageSources: new Set()
  }
  const chunkGraph = compilation.chunkGraph
  for (const chunk of compilation.chunks || []) {
    const name = String(chunk?.name || '')
    if (!name) continue
    const isBackground = /^background\//.test(name)
    const isContent = /^content_scripts\//.test(name)
    for (const module of chunkGraph.getChunkModulesIterable(chunk)) {
      let identifier = ''
      try {
        identifier = String(module.identifier())
      } catch {
        continue
      }
      for (const rel of moduleResourcesFromIdentifier(identifier, contextDir)) {
        if (isBackground) {
          index.swSources.add(rel)
        } else if (isContent) {
          let entries = index.contentEntriesBySource.get(rel)
          if (!entries) {
            entries = new Set()
            index.contentEntriesBySource.set(rel, entries)
          }
          entries.add(name)
        } else {
          index.pageSources.add(rel)
        }
      }
    }
  }
  return index
}

// Pure reload classifier shared by the launched-browser and --no-browser
// paths, so the same change always resolves to the same reload type.
export function classifyReloadFromSources(opts: {
  changedSources: string[]
  forcedFull?: boolean
  getContentScriptCount: () => number
  getSourceFeatureIndex?: () => SourceFeatureIndex | null
  outputPath?: string
}): ReloadInstruction | undefined {
  const {
    changedSources,
    forcedFull,
    getContentScriptCount,
    getSourceFeatureIndex,
    outputPath
  } = opts
  if (changedSources.length === 0) return undefined

  if (forcedFull) {
    return {
      type: 'full',
      changedAssets: changedSources,
      label: formatReloadContextLabel('extension', changedSources)
    }
  }

  let index: SourceFeatureIndex | null = null
  try {
    index = getSourceFeatureIndex ? getSourceFeatureIndex() : null
  } catch {
    index = null
  }

  const swChanged: string[] = []
  const contentEntries = new Set<string>()
  const contentChanged: string[] = []
  const pageChanged: string[] = []
  const unknown: string[] = []
  for (const rel of changedSources) {
    // A source can live in MORE than one chunk family; record every
    // membership so the instruction can fan out to both reload paths.
    let known = false
    if (index?.swSources.has(rel)) {
      swChanged.push(rel)
      known = true
    }
    if (index?.contentEntriesBySource.has(rel)) {
      contentChanged.push(rel)
      for (const entry of index.contentEntriesBySource.get(rel)!) {
        contentEntries.add(entry)
      }
      known = true
    }
    if (!known && index?.pageSources.has(rel)) {
      pageChanged.push(rel)
      known = true
    }
    if (!known) {
      unknown.push(rel)
    }
  }

  // A changed emitted static asset (icon, web-accessible resource, DNR
  // ruleset…) needs a full extension reload to be re-read from disk.
  const staticAssetChanged =
    outputPath &&
    unknown.some((rel) => {
      try {
        return fs.existsSync(path.join(outputPath, rel))
      } catch {
        return false
      }
    })

  if (swChanged.length > 0) {
    // A shared module (SW chunk + content chunk) needs BOTH paths: the SW
    // restart carries the instruction plus the stale content-script entries.
    return {
      type: 'service-worker',
      ...(contentEntries.size > 0
        ? {changedContentScriptEntries: [...contentEntries].sort()}
        : {}),
      changedAssets: changedSources,
      label: formatReloadContextLabel(
        contentEntries.size > 0
          ? 'service_worker + content_script'
          : 'service_worker',
        swChanged
      )
    }
  }

  if (staticAssetChanged) {
    return {
      type: 'full',
      changedAssets: changedSources,
      label: formatReloadContextLabel('extension', changedSources)
    }
  }

  if (contentChanged.length > 0) {
    return {
      type: 'content-scripts',
      changedContentScriptEntries: [...contentEntries].sort(),
      changedAssets: changedSources,
      label: formatReloadContextLabel('content_script', contentChanged)
    }
  }

  if (pageChanged.length > 0 && unknown.length === 0) {
    return {
      type: 'page',
      changedAssets: changedSources,
      label: formatReloadContextLabel(
        pageContextFromSources(pageChanged),
        pageChanged
      )
    }
  }

  const isServiceWorkerSource = (rel: string) =>
    /(^|\/)background(\.|\/)/i.test(rel) || /service[-_.]?worker/i.test(rel)

  if (unknown.some(isServiceWorkerSource)) {
    return {
      type: 'service-worker',
      changedAssets: changedSources,
      label: formatReloadContextLabel('service_worker', changedSources)
    }
  }

  const contentScriptCount = getContentScriptCount()
  if (contentScriptCount > 0) {
    const entries: string[] = []
    for (let i = 0; i < contentScriptCount; i++) {
      entries.push(getCanonicalContentScriptEntryName(i))
    }
    return {
      type: 'content-scripts',
      changedContentScriptEntries: entries,
      changedAssets: changedSources,
      label: formatReloadContextLabel('content_script', changedSources)
    }
  }

  // Page-only edit: livereload owns the actual refresh; emit a notify-only
  // instruction so the reload announcement surfaces still fire.
  return {
    type: 'page',
    changedAssets: changedSources,
    label: formatReloadContextLabel(
      pageContextFromSources(changedSources),
      changedSources
    )
  }
}

export function readContentScriptCount(
  compilation: import('@rspack/core').Compilation,
  outputPath: string
): number {
  try {
    const asset = compilation.getAsset?.('manifest.json')
    if (asset?.source) {
      const manifest = JSON.parse(String(asset.source.source()))
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // Ignore
  }

  try {
    const manifestPath = path.join(outputPath, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(
        stripBom(fs.readFileSync(manifestPath, 'utf8'))
      )
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // Ignore
  }

  return 0
}
