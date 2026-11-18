// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation, Compiler} from '@rspack/core'
import {scriptsFolderRoot} from './folders-config'
import {
  collectReferenceCorpus,
  getSpecialFoldersDataForCompiler,
  referenceSpellings
} from './get-data'
import * as messages from './messages'

// An import names a source file, never the file the build emits for it, so
// specifiers are cut before the text is searched for an output path.
const IMPORT_SPECIFIERS =
  /\b(?:from|import|require)\s*\(?\s*(?:'[^'\n]*'|"[^"\n]*")/g

const reportedByCompiler = new WeakMap<Compiler, Set<string>>()

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

// The bundler names a module by its real path, so a project reached through
// a symlink (macOS /var, a pnpm workspace link) is matched on that spelling.
function realPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

interface ScriptsEntry {
  key: string
  file: string
}

function scriptsFolderEntries(compiler: Compiler): Map<string, ScriptsEntry> {
  const entries = new Map<string, ScriptsEntry>()
  const {scripts} = getSpecialFoldersDataForCompiler(compiler)

  for (const [key, value] of Object.entries(scripts || {})) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) {
      const file = path.resolve(String(entry))
      entries.set(realPath(file), {key, file})
    }
  }

  return entries
}

function importedByAnotherFile(
  compilation: Compilation,
  module: Parameters<Compilation['moduleGraph']['getIncomingConnections']>[0],
  resource: string
): boolean {
  for (const {originModule} of compilation.moduleGraph.getIncomingConnections(
    module
  )) {
    const origin = String(
      (originModule as {resource?: unknown} | null)?.resource || ''
    ).split('?')[0]

    if (!origin || realPath(origin) === resource) continue
    if (/[\\/]node_modules[\\/]/.test(origin)) continue

    return true
  }

  return false
}

function readOwnSources(files: Iterable<string>): string {
  const parts: string[] = []

  for (const file of files) {
    try {
      parts.push(fs.readFileSync(file, 'utf8'))
    } catch {
      // Ignore
    }
  }

  return parts.join('\n')
}

// Every file in the scripts folder is an entry, so a helper kept beside the
// scripts that import it ships as a file of its own that nothing ever loads.
export class HintImportOnlyScripts {
  apply(compiler: Compiler) {
    const name = HintImportOnlyScripts.name

    compiler.hooks.compilation.tap(name, (compilation) => {
      compilation.hooks.finishModules.tap(name, (modules) => {
        const projectRoot = compiler.options.context || ''
        const entries = scriptsFolderEntries(compiler)
        if (!projectRoot || entries.size === 0) return

        const imported: string[] = []

        for (const module of modules) {
          const raw = String((module as {resource?: unknown}).resource || '')
          if (!raw) continue

          const resource = realPath(raw.split('?')[0])
          if (!entries.has(resource) || imported.includes(resource)) continue

          if (importedByAnotherFile(compilation, module, resource)) {
            imported.push(resource)
          }
        }

        if (imported.length === 0) return

        const reported = reportedByCompiler.get(compiler) || new Set<string>()
        reportedByCompiler.set(compiler, reported)

        const signature = imported.slice().sort().join('|')
        if (reported.has(signature)) return

        reported.add(signature)

        // The project walk skips any folder named scripts, so the entries
        // themselves are read too: one of them may inject another by path.
        const corpus = (
          collectReferenceCorpus(projectRoot) +
          '\n' +
          readOwnSources(entries.keys())
        ).replace(IMPORT_SPECIFIERS, '')

        const unnamed = imported
          .map((resource) => {
            const {key, file} = entries.get(resource) as ScriptsEntry

            return {key, relative: toPosix(path.relative(projectRoot, file))}
          })
          .filter(({key, relative}) => {
            const spellings = [
              ...referenceSpellings(relative),
              `${key}${path.extname(relative)}`,
              `${key}.js`
            ]

            return !spellings.some((spelling) => corpus.includes(spelling))
          })
          .map(({relative}) => relative)
          .sort()

        if (unnamed.length === 0) return

        const folder = toPosix(
          path.relative(
            projectRoot,
            scriptsFolderRoot(projectRoot) || path.join(projectRoot, 'scripts')
          )
        )
        const ErrorCtor = compiler.rspack?.WebpackError || Error
        const warning = new ErrorCtor(
          messages.scriptsEntriesOnlyImported(unnamed, `${folder}/`)
        )

        warning.name = 'ScriptsFolderEntryOnlyImported'
        compilation.warnings.push(warning)
      })
    })
  }
}
