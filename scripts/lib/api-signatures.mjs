// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

/** @param {string} value */
const toPosix = (value) => value.split(path.sep).join('/')

/** @param {string} text */
const toLf = (text) => text.replace(/\r\n/g, '\n')

/**
 * @typedef {{subpath: string, source: string, declarationFile: boolean}} PublishedEntry
 * @typedef {{module: string, imported: string}} ImportedName
 * @typedef {{local: string} | {module: string, name: string}} ExportedName
 * @typedef {{
 *   imports: Map<string, ImportedName>,
 *   locals: Map<string, string[]>,
 *   exports: Map<string, ExportedName>,
 *   stars: string[]
 * }} DeclarationFile
 * @typedef {{file: string, name: string} | {external: string, name: string}} Resolved
 */

// The source file behind each typed entry of a package's exports map. A
// pattern export has no single file, and an entry without types has no report.
/**
 * @param {string} packageDir
 * @returns {PublishedEntry[]}
 */
export function publishedEntries(packageDir) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
  )
  const packageFolder = path.basename(packageDir)
  /** @type {PublishedEntry[]} */
  const entries = []

  for (const [subpath, target] of Object.entries(manifest.exports || {})) {
    if (subpath.includes('*')) continue
    if (!target || typeof target !== 'object') continue

    const types = /** @type {{types?: unknown}} */ (target).types

    if (typeof types !== 'string') continue

    const published = types.replace(/^\.\//, '')

    // A target outside dist is a declaration file the package ships as is.
    if (!published.startsWith('dist/')) {
      entries.push({subpath, source: published, declarationFile: true})

      continue
    }

    let built = published.replace(/^dist\//, '')

    if (built.startsWith(`${packageFolder}/`)) {
      built = built.slice(packageFolder.length + 1)
    }

    const source = built.replace(/\.d\.ts$/, '.ts')

    if (!fs.existsSync(path.join(packageDir, source))) {
      throw new Error(
        `${subpath} of ${packageFolder} has no source for ${types}`
      )
    }

    entries.push({subpath, source, declarationFile: false})
  }

  return entries
}

// Declarations only, read from source the way the root typecheck reads them,
// so the report never depends on a dist folder being fresh.
/**
 * @param {string[]} sources absolute source files
 * @param {string} outDir
 * @param {string} [root]
 */
export function emitDeclarations(sources, outDir, root = repoRoot) {
  const tsconfig = path.join(outDir, 'tsconfig.api-signatures.json')

  fs.mkdirSync(outDir, {recursive: true})
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: toPosix(path.join(root, 'tsconfig.json')),
      compilerOptions: {
        noEmit: false,
        emitDeclarationOnly: true,
        declaration: true,
        removeComments: true,
        newLine: 'lf',
        rootDir: toPosix(path.join(root, 'programs')),
        outDir: toPosix(path.join(outDir, 'out')),
        typeRoots: [toPosix(path.join(root, 'node_modules', '@types'))]
      },
      include: [],
      files: sources.map(toPosix)
    })
  )

  const run = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      tsconfig,
      '--pretty',
      'false'
    ],
    {encoding: 'utf8'}
  )

  if (run.error) throw run.error

  if (run.status !== 0) {
    throw new Error(
      `tsc could not emit the declarations:\n${run.stdout}${run.stderr}`
    )
  }

  return path.join(outDir, 'out')
}

const STRING = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/

/** @param {string} list */
function specifiers(list) {
  /** @type {Array<{name: string, alias: string}>} */
  const found = []

  for (const item of list.split(',')) {
    const words = item
      .trim()
      .split(/\s+/)
      .filter((word) => word && word !== 'type')

    if (words.length === 0) continue

    found.push({name: words[0], alias: words[words.length - 1]})
  }

  return found
}

// tsc writes each top-level statement from the first column and indents or
// closes what belongs to it, so a line that starts with a word starts one.
/** @param {string} text */
function statementsOf(text) {
  /** @type {string[]} */
  const statements = []

  for (const line of toLf(text).split('\n')) {
    const trimmed = line.trimEnd()

    if (trimmed === '' || trimmed.startsWith('#!')) continue

    if (/^[A-Za-z]/.test(trimmed) || statements.length === 0) {
      statements.push(trimmed)
    } else {
      statements[statements.length - 1] += `\n${trimmed}`
    }
  }

  return statements
}

/**
 * @param {string} text
 * @returns {DeclarationFile}
 */
export function parseDeclarationFile(text) {
  /** @type {DeclarationFile} */
  const file = {
    imports: new Map(),
    locals: new Map(),
    exports: new Map(),
    stars: []
  }

  /**
   * @param {string} name
   * @param {string} statement
   */
  const declare = (name, statement) => {
    file.locals.set(name, [...(file.locals.get(name) || []), statement])
  }

  for (const statement of statementsOf(text)) {
    const flat = statement.replace(/\s+/g, ' ')
    const from = new RegExp(`from ${STRING.source};?$`).exec(flat)
    const module = from?.[2]

    if (flat.startsWith('import ')) {
      if (!module) continue

      const clause = flat.slice('import '.length, from.index).trim()
      const named = /\{(.*)\}/.exec(clause)
      const namespace = /\*\s+as\s+([\w$]+)/.exec(clause)
      const lead = /^(?:type\s+)?([\w$]+)\s*(?:,|$)/.exec(
        clause.replace(/\{.*\}/, '').trim()
      )

      for (const {name, alias} of specifiers(named?.[1] || '')) {
        file.imports.set(alias, {module, imported: name})
      }

      if (namespace) file.imports.set(namespace[1], {module, imported: '*'})

      if (lead && lead[1] !== 'type') {
        file.imports.set(lead[1], {module, imported: 'default'})
      }

      continue
    }

    const star = /^export \*(?: as ([\w$]+))? from /.exec(flat)

    if (star && module) {
      if (star[1]) file.exports.set(star[1], {module, name: '*'})
      else file.stars.push(module)

      continue
    }

    const list = /^export (?:type )?\{(.*)\}/.exec(flat)

    if (list) {
      for (const {name, alias} of specifiers(list[1])) {
        file.exports.set(alias, module ? {module, name} : {local: name})
      }

      continue
    }

    const named =
      /^(export )?(default )?(?:declare )?(?:abstract )?(?:async )?(?:function\*?|const|let|var|class|interface|type|enum|namespace|module) ([\w$]+)/.exec(
        flat
      )

    if (named) {
      const text = statement.replace(/^export (default )?/, '')

      declare(named[3], text)
      if (named[1]) file.exports.set(named[3], {local: named[3]})
      if (named[2]) file.exports.set('default', {local: named[3]})

      continue
    }

    const defaultName = /^export default ([\w$]+);?$/.exec(flat)

    if (defaultName) {
      file.exports.set('default', {local: defaultName[1]})

      continue
    }

    throw new Error(
      `a declaration statement the report cannot read:\n${statement}`
    )
  }

  return file
}

// Every declaration a published entry exposes: what it exports, and each
// declaration of this package those reach, by import or by inline import().
/**
 * @param {string} declarationsDir the emitted tree, one folder per package
 * @param {string} entryFile the entry inside it, in posix form
 */
export function reportEntry(declarationsDir, entryFile) {
  /** @type {Map<string, DeclarationFile | undefined>} */
  const parsed = new Map()

  /** @param {string} file */
  const read = (file) => {
    if (!parsed.has(file)) {
      const absolute = path.join(declarationsDir, file)

      parsed.set(
        file,
        fs.existsSync(absolute)
          ? parseDeclarationFile(fs.readFileSync(absolute, 'utf8'))
          : undefined
      )
    }

    return parsed.get(file)
  }

  /**
   * @param {string} from
   * @param {string} specifier
   */
  const moduleFile = (from, specifier) => {
    if (!specifier.startsWith('.')) return undefined

    const base = path.posix
      .join(path.posix.dirname(from), specifier)
      .replace(/\.[cm]?[jt]s$/, '')

    return [`${base}.d.ts`, `${base}/index.d.ts`].find((file) => read(file))
  }

  /**
   * @param {string} from
   * @param {string} specifier
   */
  const moduleName = (from, specifier) =>
    specifier.startsWith('.')
      ? path.posix
          .join(path.posix.dirname(from), specifier)
          .replace(/\.[cm]?[jt]s$/, '')
      : specifier

  /**
   * @param {string} file
   * @param {string} name
   * @param {Set<string>} [seen]
   * @returns {Resolved | undefined}
   */
  const resolveExport = (file, name, seen = new Set()) => {
    const key = `${file}#${name}`
    const declarations = read(file)

    if (!declarations || seen.has(key)) return undefined

    seen.add(key)

    const exported = declarations.exports.get(name)

    if (exported && 'local' in exported) {
      return resolveName(file, exported.local, seen)
    }

    if (exported) {
      const target = moduleFile(file, exported.module)

      return target
        ? resolveExport(target, exported.name, seen)
        : {external: moduleName(file, exported.module), name: exported.name}
    }

    for (const specifier of declarations.stars) {
      const target = moduleFile(file, specifier)
      const found = target && resolveExport(target, name, seen)

      if (found) return found
    }

    return undefined
  }

  /**
   * @param {string} file
   * @param {string} name
   * @param {Set<string>} [seen]
   * @returns {Resolved | undefined}
   */
  const resolveName = (file, name, seen = new Set()) => {
    const declarations = read(file)

    if (!declarations) return undefined
    if (declarations.locals.has(name)) return {file, name}

    const imported = declarations.imports.get(name)

    if (!imported) return undefined

    const target = moduleFile(file, imported.module)

    if (!target) {
      return {
        external: moduleName(file, imported.module),
        name: imported.imported
      }
    }

    return imported.imported === '*'
      ? {file: target, name: '*'}
      : resolveExport(target, imported.imported, seen)
  }

  /**
   * @param {string} file
   * @param {Set<string>} [seen]
   * @returns {string[]}
   */
  const exportNames = (file, seen = new Set()) => {
    const declarations = read(file)

    if (!declarations || seen.has(file)) return []

    seen.add(file)

    return [
      ...declarations.exports.keys(),
      ...declarations.stars.flatMap((specifier) => {
        const target = moduleFile(file, specifier)

        return target
          ? exportNames(target, seen).filter((name) => name !== 'default')
          : []
      })
    ]
  }

  /** @type {Map<string, string>} */
  const printed = new Map()
  /** @type {Set<string>} */
  const externals = new Set()
  /** @type {Resolved[]} */
  const queue = []

  /** @param {Resolved | undefined} resolved */
  const label = (resolved) => {
    if (!resolved) return 'not found'
    if ('external' in resolved) return `${resolved.external}#${resolved.name}`

    return `${resolved.file.replace(/\.d\.ts$/, '')}#${resolved.name}`
  }

  /** @param {Resolved | undefined} resolved */
  const reach = (resolved) => {
    if (!resolved) return

    if ('external' in resolved) {
      externals.add(label(resolved))

      return
    }

    if (resolved.name === '*') {
      for (const name of exportNames(resolved.file)) {
        reach(resolveExport(resolved.file, name))
      }

      return
    }

    if (printed.has(label(resolved))) return

    printed.set(label(resolved), '')
    queue.push(resolved)
  }

  const exportLines = [...new Set(exportNames(entryFile))]
    .sort()
    .map((name) => {
      const resolved = resolveExport(entryFile, name)

      reach(resolved)

      return `${name} = ${label(resolved)}`
    })

  for (let next = queue.shift(); next; next = queue.shift()) {
    if (!('file' in next)) continue

    const {file, name} = next
    const declarations = /** @type {DeclarationFile} */ (read(file))
    const inlineImport = new RegExp(
      `import\\(${STRING.source}\\)(?:\\.([\\w$]+))?`,
      'g'
    )
    const text = (declarations.locals.get(name) || [])
      .join('\n')
      .replace(inlineImport, (_match, _quote, specifier, member) => {
        const target = moduleFile(file, specifier)

        if (!target) {
          externals.add(`${moduleName(file, specifier)}#${member || '*'}`)
        } else {
          reach(
            member ? resolveExport(target, member) : {file: target, name: '*'}
          )
        }

        const named = `import("${moduleName(file, specifier)}")`

        return member ? `${named}.${member}` : named
      })

    printed.set(label(next), text)

    const words = new Set(
      text
        .replace(new RegExp(STRING.source, 'g'), '')
        .match(/[A-Za-z_$][\w$]*/g)
    )

    words.delete(name)

    for (const word of words) {
      if (declarations.locals.has(word) || declarations.imports.has(word)) {
        reach(resolveName(file, word))
      }
    }
  }

  return [
    '# exports',
    ...exportLines,
    '',
    '# from other packages',
    ...[...externals].sort(),
    '',
    '# declarations',
    ...[...printed.keys()]
      .sort()
      .flatMap((key) => ['', `## ${key}`, printed.get(key) || ''])
  ].join('\n')
}

/** @param {string} text */
function withoutComments(text) {
  return toLf(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\/(?!\/ <reference)/.test(line))
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .join('\n')
}

// A hand-written declaration entry is its own report, with each file it
// references by path. A generated file is named: its generator pins it.
/**
 * @param {string} packageDir
 * @param {string} entry
 */
export function reportDeclarationFile(packageDir, entry) {
  /** @type {Map<string, string>} */
  const files = new Map()
  const queue = [entry]

  for (let file = queue.shift(); file; file = queue.shift()) {
    if (files.has(file)) continue

    const text = toLf(fs.readFileSync(path.join(packageDir, file), 'utf8'))
    const generator = /^\/\/ Generated by (scripts\/[\w.-]+)/m.exec(text)

    files.set(
      file,
      generator ? `generated by ${generator[1]}` : withoutComments(text)
    )

    for (const [, reference] of text.matchAll(
      /^\/\/\/ <reference path="([^"]+)" \/>/gm
    )) {
      queue.push(path.posix.join(path.posix.dirname(file), reference))
    }
  }

  return [...files.keys()]
    .sort()
    .flatMap((file) => [`## ${file}`, files.get(file) || '', ''])
    .join('\n')
    .trimEnd()
}

// The signature report of every published entry of one package, by subpath.
/**
 * @param {string} packageDir
 * @param {string} [root]
 * @returns {Record<string, string>}
 */
export function signatureReports(packageDir, root = repoRoot) {
  const entries = publishedEntries(packageDir)
  const compiled = entries.filter((entry) => !entry.declarationFile)
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-api-signatures-')
  )
  /** @type {Record<string, string>} */
  const reports = {}

  try {
    const declarationsDir =
      compiled.length > 0
        ? emitDeclarations(
            compiled.map((entry) => path.join(packageDir, entry.source)),
            workDir,
            root
          )
        : workDir
    const packageFolder = toPosix(
      path.relative(path.join(root, 'programs'), packageDir)
    )

    for (const entry of entries) {
      reports[entry.subpath] = entry.declarationFile
        ? reportDeclarationFile(packageDir, entry.source)
        : reportEntry(
            declarationsDir,
            `${packageFolder}/${entry.source.replace(/\.ts$/, '.d.ts')}`
          )
    }
  } finally {
    fs.rmSync(workDir, {recursive: true, force: true})
  }

  return reports
}
