// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {FilepathList} from '../../../types'
import {getAssetsFromHtml} from '../../feature-html/html-lib/utils'
import {
  compiledSourceEmittedPath,
  extractMainWorldRegisteredFileLiterals,
  resolveExtensionPath
} from '../steps/trace-runtime-loaded-files'
import {getScriptEntries, isRemoteUrl, resolveScriptEntryPath} from './utils'

export interface RuntimeMainWorldEntry {
  entryName: string
  files: string[]
}

export interface RuntimeMainWorldOptions {
  includeList: FilepathList
  // The HTML pages this build compiles, whose scripts can register too.
  pageList?: FilepathList
  manifestDir: string
  projectPath: string
}

const isScriptsFolderFeature = (feature: string) =>
  feature.startsWith('scripts/')

// Cheap gates, so a source with no scripting call is never tokenized.
const MAIN_WORLD_CALL =
  /\b(?:registerContentScripts|updateContentScripts|executeScript)\b/
const REGISTRY_CALL =
  /\b(?:register|update|unregister|getRegistered)ContentScripts\b/

function collectScriptEntries(
  options: RuntimeMainWorldOptions
): Map<string, string[]> {
  const {includeList, manifestDir, projectPath} = options
  const entries = new Map<string, string[]>()

  for (const [feature, value] of Object.entries(includeList || {})) {
    const raw = Array.isArray(value) ? value : value ? [value] : []
    const files = getScriptEntries(
      raw
        .filter(
          (entry): entry is string =>
            typeof entry === 'string' && !!entry && !isRemoteUrl(entry)
        )
        .map((entry) => resolveScriptEntryPath(entry, manifestDir, projectPath))
    )

    if (files.length > 0) entries.set(feature, files)
  }

  return entries
}

// The script files each HTML page loads, read through the parse the HTML
// feature already made and cached for the same page.
function collectPageScripts(
  pageList: FilepathList | undefined
): Map<string, string[]> {
  const pages = new Map<string, string[]>()

  for (const [feature, value] of Object.entries(pageList || {})) {
    if (typeof value !== 'string' || !value) continue

    let scripts: string[]

    try {
      scripts = getAssetsFromHtml(value).js || []
    } catch {
      continue
    }

    const files = getScriptEntries(
      scripts.filter((script) => !!script && !isRemoteUrl(script))
    )

    if (files.length > 0) pages.set(feature, files)
  }

  return pages
}

function readSource(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// Every entry name a runtime registration or injection puts in the MAIN
// world, read from the sources this build already compiles.
function readRegisteredMainWorldEntryNames(files: string[]): Set<string> {
  const names = new Set<string>()

  for (const file of files) {
    const source = readSource(file)
    if (!MAIN_WORLD_CALL.test(source)) continue

    for (const literal of extractMainWorldRegisteredFileLiterals(source)) {
      const distRel = resolveExtensionPath(literal, '')
      if (!distRel) continue

      const emitted = compiledSourceEmittedPath(distRel) || distRel
      if (!/\.js$/i.test(emitted)) continue

      names.add(emitted.replace(/\.js$/i, ''))
    }
  }

  return names
}

// The scripts/ entries a registerContentScripts or executeScript call runs in
// the page's own world, which the manifest never names. Declared
// content_scripts groups are left to the manifest lane: one also registered
// at runtime still has its declared injection to serve.
export function findRuntimeMainWorldEntries(
  options: RuntimeMainWorldOptions
): RuntimeMainWorldEntry[] {
  const entries = collectScriptEntries(options)
  const candidates = [...entries].filter(([entryName]) =>
    isScriptsFolderFeature(entryName)
  )
  // No scripts/ entry can be registered, so no source is read at all.
  if (candidates.length === 0) return []

  // An extension page registers through the same API as the background.
  const registered = readRegisteredMainWorldEntryNames([
    ...[...entries.values()].flat(),
    ...[...collectPageScripts(options.pageList).values()].flat()
  ])

  return candidates
    .filter(([entryName]) => registered.has(entryName))
    .map(([entryName, files]) => ({entryName, files}))
}

// The pages whose scripts reach the content script registry. Each runs in
// its own realm, so each needs the pairing the background carries.
export function findRegistryCallingPages(
  pageList: FilepathList | undefined
): string[] {
  const found: string[] = []

  for (const [feature, files] of collectPageScripts(pageList)) {
    if (files.some((file) => REGISTRY_CALL.test(readSource(file)))) {
      found.push(feature)
    }
  }

  return found
}
