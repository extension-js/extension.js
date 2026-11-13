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
  collectModuleSpecifiers,
  createLocalImportResolver,
  type LocalImportResolver,
  readScriptText,
  walkLocalImportGraph
} from '../../shared/script-graph'
import {
  compiledSourceEmittedPath,
  extractInjectedFileLiterals,
  type ImportedModuleReader,
  resolveExtensionPath
} from '../steps/trace-runtime-loaded-files'
import {mainWorldCopyEntryName} from '../contracts'
import {extractRegisteredFileSightings} from './registration-worlds'
import {getScriptEntries, isRemoteUrl, resolveScriptEntryPath} from './utils'

export interface RuntimeMainWorldEntry {
  entryName: string
  files: string[]
  // The source that holds the registration or injection.
  registeredBy: string
  // The scripts/ entry this one is the MAIN world copy of, when the same
  // file also runs in the isolated world and keeps its own name there.
  copyOf?: string
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

// What one source file says, kept per file so the steps that ask the same
// question of the same build read and resolve each file once.
interface SourceFacts {
  file: string
  stamp: string
  // The resolver options the imports below were resolved with.
  scope: string
  // The modules a constant was read from, which the stamp above cannot see.
  constantSources: Array<{file: string; stamp: string}>
  mainWorldFiles: string[]
  // The MAIN world paths a registration names, which the browser keeps.
  keptMainWorldFiles: string[]
  // The paths a call runs in the isolated world, or in one it cannot name.
  isolatedFiles: string[]
  // The calls that name a file and leave its world to the running code.
  unknownWorlds: Array<{literal: string; line: number}>
  // Every path a registration or injection names, whatever the world.
  injectedFiles: string[]
  callsRegistry: boolean
  imports: string[]
}

const factsCache = new Map<string, SourceFacts>()

function fileStamp(file: string): string | undefined {
  try {
    const stat = fs.statSync(file)

    return stat.isFile() ? `${stat.mtimeMs}:${stat.size}` : undefined
  } catch {
    return undefined
  }
}

function readSourceFacts(
  file: string,
  resolveImport: LocalImportResolver
): SourceFacts | undefined {
  const stamp = fileStamp(file)
  if (stamp === undefined) return undefined

  const cached = factsCache.get(file)

  if (
    cached?.stamp === stamp &&
    cached.scope === resolveImport.scope &&
    cached.constantSources.every(
      (source) => fileStamp(source.file) === source.stamp
    )
  ) {
    return cached
  }

  const source = readScriptText(file) || ''
  const imports = new Set<string>()

  for (const specifier of collectModuleSpecifiers(source)) {
    const resolved = resolveImport(file, specifier)
    if (resolved) imports.add(resolved)
  }

  const constantSources: SourceFacts['constantSources'] = []

  // A registration may name a constant another local module exports. The
  // module is handed back with its file, so its own imports resolve from it.
  const readImported: ImportedModuleReader = (specifier, fromFile = file) => {
    const resolved = resolveImport(fromFile, specifier)
    const resolvedStamp = resolved && fileStamp(resolved)
    if (!resolved || !resolvedStamp) return null

    constantSources.push({file: resolved, stamp: resolvedStamp})

    const text = readScriptText(resolved)

    return text == null ? null : {source: text, file: resolved}
  }

  const names = MAIN_WORLD_CALL.test(source)
  const sightings = names
    ? extractRegisteredFileSightings(source, readImported)
    : []
  const filesIn = (...worlds: string[]) => [
    ...new Set(
      sightings
        .filter((sighting) => worlds.includes(sighting.world))
        .map((sighting) => sighting.file)
    )
  ]
  const mainWorldFiles = filesIn('MAIN')
  const unknownWorlds = new Map<string, {literal: string; line: number}>()

  for (const {file: literal, world, index} of sightings) {
    if (world !== 'UNKNOWN') continue

    // Counted on line feeds alone, so a CRLF file numbers its lines alike.
    const line = source.slice(0, index).split('\n').length
    unknownWorlds.set(`${line}:${literal}`, {literal, line})
  }

  const facts: SourceFacts = {
    file,
    stamp,
    scope: resolveImport.scope,
    constantSources,
    mainWorldFiles,
    keptMainWorldFiles: [
      ...new Set(
        sightings
          .filter((sighting) => sighting.world === 'MAIN' && sighting.kept)
          .map((sighting) => sighting.file)
      )
    ],
    isolatedFiles: filesIn('ISOLATED', 'UNKNOWN'),
    unknownWorlds: [...unknownWorlds.values()],
    injectedFiles: names
      ? [
          ...new Set([
            ...extractInjectedFileLiterals(source, readImported),
            ...mainWorldFiles
          ])
        ]
      : [],
    callsRegistry: REGISTRY_CALL.test(source),
    imports: [...imports]
  }
  factsCache.set(file, facts)

  return facts
}

// The facts of every source the entries reach: the entry files and the
// local modules they import, never a package.
function readReachableFacts(
  entries: string[],
  projectPath: string
): SourceFacts[] {
  const resolveImport = createLocalImportResolver(projectPath)
  const reached: SourceFacts[] = []

  walkLocalImportGraph(entries, (file) => {
    const facts = readSourceFacts(file, resolveImport)
    if (!facts) return []

    reached.push(facts)

    return facts.imports
  })

  return reached
}

// The entry name a registered or injected path names once the build has
// emitted it, or null when it names no script.
function registeredEntryName(literal: string): string | null {
  const distRel = resolveExtensionPath(literal, '')
  if (!distRel) return null

  const emitted = compiledSourceEmittedPath(distRel) || distRel
  if (!/\.js$/i.test(emitted)) return null

  return emitted.replace(/\.js$/i, '')
}

interface RegisteredWorlds {
  // Each entry name put in the MAIN world and the first source that names it.
  main: Map<string, string>
  // The entry names a registration puts in the MAIN world.
  kept: Set<string>
  isolated: Set<string>
}

// The worlds every runtime registration or injection gives each entry
// name, read from what this build compiles.
function readRegisteredWorlds(
  files: string[],
  projectPath: string
): RegisteredWorlds {
  const main = new Map<string, string>()
  const isolated = new Set<string>()
  const kept = new Set<string>()

  for (const facts of readReachableFacts(files, projectPath)) {
    for (const literal of facts.keptMainWorldFiles) {
      const name = registeredEntryName(literal)
      if (name) kept.add(name)
    }

    for (const literal of facts.mainWorldFiles) {
      const name = registeredEntryName(literal)
      if (name && !main.has(name)) main.set(name, facts.file)
    }

    for (const literal of facts.isolatedFiles) {
      const name = registeredEntryName(literal)
      if (name) isolated.add(name)
    }
  }

  return {main, kept, isolated}
}

const sameFiles = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((file, index) => file === right[index])

// The scripts/ entries a registerContentScripts or executeScript call runs in
// the page's own world, which the manifest never names. Declared
// content_scripts groups are left to the manifest lane: one also registered
// at runtime still has its declared injection to serve. A file the isolated
// world runs too is answered as its MAIN world copy, under the copy's name.
export function findRuntimeMainWorldEntries(
  options: RuntimeMainWorldOptions
): RuntimeMainWorldEntry[] {
  const entries = collectScriptEntries(options)
  const candidates = [...entries].filter(([entryName]) =>
    isScriptsFolderFeature(entryName)
  )
  // No scripts/ entry can be registered, so no source is read at all.
  if (candidates.length === 0) return []

  // An extension page registers through the same API as the background,
  // and either one may keep the call in a module it imports.
  const registered = readRegisteredWorlds(
    [
      ...[...entries.values()].flat(),
      ...[...collectPageScripts(options.pageList).values()].flat()
    ],
    options.projectPath
  )
  const found: RuntimeMainWorldEntry[] = []

  for (const [entryName, files] of candidates) {
    const registeredBy = registered.main.get(entryName)
    if (!registeredBy) continue

    const copyName = mainWorldCopyEntryName(entryName)
    const taken = entries.get(copyName)
    // A file of the author's own under the copy's name keeps that name.
    const free = !taken || sameFiles(taken, files)
    const copy = {entryName: copyName, files, registeredBy, copyOf: entryName}

    if (registered.isolated.has(entryName) && free) {
      found.push(copy)
      continue
    }

    found.push({entryName, files, registeredBy})
    // The browser keeps the path a file was registered under, and the copy
    // is the one path that stays a MAIN world build when the worlds change.
    if (registered.kept.has(entryName) && free) found.push(copy)
  }

  return found
}

// The list with an entry of its own for each MAIN world copy, so the steps
// that read the list build and name the copy like any other scripts/ file.
export function withMainWorldCopyEntries(
  options: RuntimeMainWorldOptions
): FilepathList {
  const copies = findRuntimeMainWorldEntries(options).filter(
    (entry) => entry.copyOf
  )
  if (copies.length === 0) return options.includeList

  const list: FilepathList = {...options.includeList}

  for (const {entryName, copyOf} of copies) {
    list[entryName] = options.includeList[copyOf as string]
  }

  return list
}

export interface UnknownWorldRegistration {
  // The source that holds the call, and the line the call starts on.
  file: string
  line: number
  literal: string
  emitted: string
}

// The calls that name a scripts/ file and leave its world to running code,
// which no build can read. Such a file is built for the isolated world.
export function findUnknownWorldRegistrations(
  options: RuntimeMainWorldOptions
): UnknownWorldRegistration[] {
  const entries = collectScriptEntries(options)
  const scripts = new Set([...entries.keys()].filter(isScriptsFolderFeature))
  if (scripts.size === 0) return []

  const found: UnknownWorldRegistration[] = []
  const sources = [
    ...[...entries.values()].flat(),
    ...[...collectPageScripts(options.pageList).values()].flat()
  ]

  for (const facts of readReachableFacts(sources, options.projectPath)) {
    for (const {literal, line} of facts.unknownWorlds) {
      const entryName = registeredEntryName(literal)
      if (!entryName || !scripts.has(entryName)) continue

      found.push({file: facts.file, line, literal, emitted: `${entryName}.js`})
    }
  }

  return found
}

export interface PageRelativeScriptPath {
  page: string
  // The source that names the path, which may be a module the page imports.
  file: string
  literal: string
  // Where a browser that resolves against the page looks, and the file meant.
  requested: string
  emitted: string
}

// A scripts/ file a page names without a leading slash. Gecko resolves that
// path against the page, so it points at a file the build never emits.
export function findPageRelativeScriptPaths(
  options: RuntimeMainWorldOptions
): PageRelativeScriptPath[] {
  const scripts = new Set(
    [...collectScriptEntries(options).keys()].filter(isScriptsFolderFeature)
  )
  if (scripts.size === 0) return []

  const found: PageRelativeScriptPath[] = []

  for (const [page, files] of collectPageScripts(options.pageList)) {
    for (const facts of readReachableFacts(files, options.projectPath)) {
      for (const literal of facts.injectedFiles) {
        const fromRoot = resolveExtensionPath(literal, '')
        const fromPage = resolveExtensionPath(literal, `${page}.html`)
        if (!fromRoot || !fromPage || fromRoot === fromPage) continue

        const entryName = registeredEntryName(literal)
        if (!entryName || !scripts.has(entryName)) continue

        found.push({
          page,
          file: facts.file,
          literal,
          requested: fromPage,
          emitted: `${entryName}.js`
        })
      }
    }
  }

  return found
}

// The pages whose scripts reach the content script registry or inject a
// MAIN world file. Each runs in its own realm, so each carries the pairing.
export function findBridgePairingPages(
  pageList: FilepathList | undefined,
  projectPath: string
): string[] {
  const found: string[] = []

  for (const [feature, files] of collectPageScripts(pageList)) {
    const reached = readReachableFacts(files, projectPath)

    if (
      reached.some(
        (facts) => facts.callsRegistry || facts.mainWorldFiles.length > 0
      )
    ) {
      found.push(feature)
    }
  }

  return found
}
