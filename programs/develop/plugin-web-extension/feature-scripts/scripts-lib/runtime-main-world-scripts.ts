// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {FilepathList} from '../../../types'
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

const isScriptsFolderFeature = (feature: string) =>
  feature.startsWith('scripts/')

function collectScriptEntries(options: {
  includeList: FilepathList
  manifestDir: string
  projectPath: string
}): Map<string, string[]> {
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

// Every entry name a runtime registration puts in the MAIN world, read from
// the sources of the entries this build already compiles.
function readRegisteredMainWorldEntryNames(
  entries: Map<string, string[]>
): Set<string> {
  const names = new Set<string>()

  for (const files of entries.values()) {
    for (const file of files) {
      let source: string

      try {
        source = fs.readFileSync(file, 'utf8')
      } catch {
        continue
      }

      for (const literal of extractMainWorldRegisteredFileLiterals(source)) {
        const distRel = resolveExtensionPath(literal, '')
        if (!distRel) continue

        const emitted = compiledSourceEmittedPath(distRel) || distRel
        if (!/\.js$/i.test(emitted)) continue

        names.add(emitted.replace(/\.js$/i, ''))
      }
    }
  }

  return names
}

// The scripts/ entries a runtime registration runs in the page's own world,
// which the manifest never names. Declared content_scripts groups are left to
// the manifest lane: one also registered at runtime still has its declared
// injection to serve.
export function findRuntimeMainWorldEntries(options: {
  includeList: FilepathList
  manifestDir: string
  projectPath: string
}): RuntimeMainWorldEntry[] {
  const entries = collectScriptEntries(options)
  const registered = readRegisteredMainWorldEntryNames(entries)
  const found: RuntimeMainWorldEntry[] = []

  for (const [entryName, files] of entries) {
    if (!isScriptsFolderFeature(entryName)) continue
    if (!registered.has(entryName)) continue

    found.push({entryName, files})
  }

  return found
}
