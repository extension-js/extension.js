// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {
  findPackageJsonWorkspaceRoot,
  findPnpmWorkspaceRoot
} from '../../lib/package-manager'
import {canonicalizeDir} from '../../lib/resource-path'
import {
  getUserJsConfigFile,
  getUserTypeScriptConfigFile
} from '../../plugin-js-frameworks/js-tools/typescript'

const SCRIPT_SRC_PATTERN = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi

const RELATIVE_IMPORT_PATTERN =
  /(?:import\s[^'"]*|import\s*\(\s*|require\s*\(\s*|from\s*)['"](\.{1,2}\/[^'"]+)['"]/g

// Every module specifier a source names: static import, export from,
// import() and require() with a literal. A commented one only costs a read.
const MODULE_SPECIFIER_PATTERN =
  /(?:\bimport\s*\(\s*|\brequire\s*\(\s*|\bfrom\s*|\bimport\s*)(['"`])([^'"`\n$]+)\1/g

const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']
const MAX_IMPORT_DEPTH = 3

// The same lists the bundler resolves with, so a specifier lands on the
// file the build compiles.
const RESOLVE_EXTENSIONS = [
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.json',
  '.svelte',
  '.vue'
]
const RESOLVE_EXTENSION_ALIAS = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs']
}
const SCRIPT_SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/i
const SINGLE_FILE_COMPONENT = /\.(?:vue|svelte)$/i
const COMPONENT_SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi
const NODE_MODULES_SEGMENT = /[\\/]node_modules[\\/]/

// The dependency kinds a script names a module by, in the order tried.
const DEPENDENCY_KINDS = ['esm', 'commonjs'] as const
const LINKED_DEPENDENCY = /^(?:file|link|portal):/
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies'
] as const

export const MAX_LOCAL_IMPORT_DEPTH = 8
export const MAX_LOCAL_IMPORT_FILES = 2000

export function readIfFile(absPath: string): string | undefined {
  try {
    if (fs.statSync(absPath).isFile()) return fs.readFileSync(absPath, 'utf-8')
  } catch {
    // Ignore
  }

  return undefined
}

// Authors reference emitted names (panel.js) while sources sit beside them
// as panel.ts; accept either so TypeScript projects resolve too.
function readScriptSource(absPath: string): string | undefined {
  const direct = readIfFile(absPath)
  if (direct !== undefined) return direct

  const parsed = path.parse(absPath)

  for (const ext of SOURCE_SIBLING_EXTENSIONS) {
    const sibling = readIfFile(path.join(parsed.dir, parsed.name + ext))
    if (sibling !== undefined) return sibling
  }

  return undefined
}

function collectRelativeImports(source: string): string[] {
  const specifiers: string[] = []

  for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
    specifiers.push(match[1])
  }

  return specifiers
}

// Walk a script's local import graph a few hops deep and hand each source to
// the collector: direct calls are the common shape, imports cover the rest.
export function scanScriptGraph(
  entryAbsPath: string,
  collect: (source: string) => string[]
): string[] {
  const found: string[] = []
  const queue: Array<{file: string; depth: number}> = [
    {file: entryAbsPath, depth: 0}
  ]
  const seen = new Set<string>()

  while (queue.length) {
    const {file, depth} = queue.shift() as {file: string; depth: number}
    if (seen.has(file)) continue

    seen.add(file)

    const source = readScriptSource(file)
    if (source === undefined) continue

    found.push(...collect(source))

    if (depth >= MAX_IMPORT_DEPTH) continue

    for (const specifier of collectRelativeImports(source)) {
      const resolved = path.resolve(path.dirname(file), specifier)
      const withExt = path.extname(resolved) ? resolved : `${resolved}.js`
      queue.push({file: withExt, depth: depth + 1})
    }
  }

  return found
}

export function collectModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  for (const match of source.matchAll(MODULE_SPECIFIER_PATTERN)) {
    specifiers.push(match[2])
  }

  return specifiers
}

// Whether a file is source the author wrote: a script, outside any
// installed package.
export function isLocalScriptSource(file: string): boolean {
  return SCRIPT_SOURCE.test(file) && !NODE_MODULES_SEGMENT.test(file)
}

// The script a source file holds. A single file component keeps its code
// in script blocks, and its markup would only confuse a text scan.
export function readScriptText(file: string): string | undefined {
  const source = readIfFile(file)
  if (source === undefined || !SINGLE_FILE_COMPONENT.test(file)) return source

  return [...source.matchAll(COMPONENT_SCRIPT_BLOCK)]
    .map((block) => block[1])
    .join('\n')
}

export type LocalImportResolver = ((
  fromFile: string,
  specifier: string
) => string | undefined) & {
  // Names the options this resolver reads, so an answer cached under one
  // alias map is never served to a build that resolves with another.
  scope: string
}

type ResolverOptions = NonNullable<
  ConstructorParameters<typeof rspack.experiments.resolver.ResolverFactory>[0]
>

// The resolve block of the bundler config, as loosely as a user config
// may shape it.
export type BuildResolve = Record<string, unknown>

const buildResolveByProject = new Map<
  string,
  {resolve: BuildResolve; scope: string}
>()
let buildResolveCount = 0

// Keeps the resolve block the build compiles with, user config merged in,
// so the import walk lands on the files the bundler does.
export function rememberBuildResolve(
  projectPath: string,
  resolve: unknown
): void {
  if (!resolve || typeof resolve !== 'object') {
    buildResolveByProject.delete(projectPath)

    return
  }

  if (buildResolveByProject.get(projectPath)?.resolve === resolve) return

  buildResolveByProject.set(projectPath, {
    resolve: resolve as BuildResolve,
    scope: `${projectPath}#${++buildResolveCount}`
  })
}

const isString = (value: unknown): value is string => typeof value === 'string'

// A list the config may spell with '...', which only the bundler expands.
function stringList(value: unknown): string[] | undefined {
  const list = (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => isString(item) && item !== '...'
  )

  return list.length > 0 ? list : undefined
}

function aliasTargets(value: unknown): string | false | string[] | undefined {
  if (value === false || isString(value)) return value
  if (Array.isArray(value)) return value.filter(isString)

  return undefined
}

// The alias map in the one shape the resolver takes. A config may also
// list it as {name, alias} pairs.
function aliasMap(
  value: unknown
): Record<string, string | false | string[]> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const pairs: Array<[string, unknown]> = Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === 'object')
        .map((item) => [
          `${item.name}${item.onlyModule ? '$' : ''}`,
          item.alias
        ])
    : Object.entries(value)
  const map: Record<string, string | false | string[]> = {}

  for (const [name, raw] of pairs) {
    const targets = aliasTargets(raw)
    if (targets !== undefined) map[name] = targets
  }

  return Object.keys(map).length > 0 ? map : undefined
}

function fieldList(value: unknown): Array<string | string[]> | undefined {
  if (!Array.isArray(value)) return undefined

  const list = value
    .map((item) => (Array.isArray(item) ? item.filter(isString) : item))
    .filter(
      (item): item is string | string[] =>
        Array.isArray(item) || (isString(item) && item !== '...')
    )

  return list.length > 0 ? list : undefined
}

function tsconfigFile(value: unknown): string | undefined {
  if (isString(value)) return value

  const configFile = (value as {configFile?: unknown} | undefined)?.configFile

  return isString(configFile) ? configFile : undefined
}

// What the build's resolve block says, for the fields that decide which
// file a specifier names. A linked package keeps its node_modules path.
function buildResolverOptions(
  projectPath: string,
  resolve: BuildResolve | undefined
): ResolverOptions {
  const configFile =
    tsconfigFile(resolve?.tsConfig) ??
    getUserTypeScriptConfigFile(projectPath) ??
    getUserJsConfigFile(projectPath)
  const options: ResolverOptions = {
    extensions: stringList(resolve?.extensions) ?? RESOLVE_EXTENSIONS,
    extensionAlias: RESOLVE_EXTENSION_ALIAS,
    symlinks: false,
    ...(configFile ? {tsconfig: {configFile, references: 'auto'}} : {})
  }
  if (!resolve) return options

  const alias = aliasMap(resolve.alias)
  if (alias) options.alias = alias

  const fallback = aliasMap(resolve.fallback)

  if (fallback) {
    options.fallback = Object.fromEntries(
      Object.entries(fallback)
        .filter(([, targets]) => targets !== false)
        .map(([name, targets]) => [name, [targets as string | string[]].flat()])
    )
  }

  const extensionAlias = resolve.extensionAlias

  if (extensionAlias && typeof extensionAlias === 'object') {
    options.extensionAlias = Object.fromEntries(
      Object.entries(extensionAlias).map(([extension, targets]) => [
        extension,
        stringList(targets) ?? []
      ])
    )
  }

  for (const key of ['modules', 'mainFields', 'mainFiles', 'roots'] as const) {
    const list = stringList(resolve[key])
    if (list) options[key] = list
  }

  const conditionNames = stringList(resolve.conditionNames)
  if (conditionNames) options.conditionNames = conditionNames

  for (const key of [
    'aliasFields',
    'exportsFields',
    'importsFields'
  ] as const) {
    const list = fieldList(resolve[key])
    if (list) options[key] = list
  }

  for (const key of ['preferRelative', 'preferAbsolute'] as const) {
    if (typeof resolve[key] === 'boolean') options[key] = resolve[key]
  }

  return options
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// The resolve block one dependency kind compiles with: what byDependency
// holds for it laid over the block, '...' standing for the list it extends.
function resolveForDependency(
  resolve: BuildResolve | undefined,
  kind: string
): BuildResolve | undefined {
  const byDependency = resolve?.byDependency
  const override = isPlainObject(byDependency) ? byDependency[kind] : undefined
  if (!resolve || !isPlainObject(override)) return undefined

  const merged: BuildResolve = {...resolve}
  delete merged.byDependency

  for (const [key, value] of Object.entries(override)) {
    const base = resolve[key]

    if (Array.isArray(value)) {
      merged[key] = value.flatMap((item) =>
        item === '...' ? (Array.isArray(base) ? base : []) : [item]
      )
    } else if (isPlainObject(value) && isPlainObject(base)) {
      merged[key] = {...base, ...value}
    } else {
      merged[key] = value
    }
  }

  return merged
}

interface LinkedDependency {
  name: string
  dir: string
  // A file: dependency, which a package manager may copy instead of link.
  mayBeCopied: boolean
}

// The folders a package.json names as a file:, link: or portal: dependency,
// which hold source the author keeps beside the project.
function linkedDependencies(packageDir: string): LinkedDependency[] {
  const linked: LinkedDependency[] = []

  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')
    )
    if (!isPlainObject(manifest)) return linked

    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = manifest[field]
      if (!isPlainObject(dependencies)) continue

      for (const [name, spec] of Object.entries(dependencies)) {
        if (!isString(spec) || !LINKED_DEPENDENCY.test(spec)) continue

        const target = path.resolve(
          packageDir,
          spec.replace(LINKED_DEPENDENCY, '')
        )
        linked.push({
          name,
          dir: canonicalizeDir(target),
          mayBeCopied: spec.startsWith('file:')
        })
      }
    }
  } catch {
    // Ignore, a project with no readable package.json links nothing
  }

  return linked
}

// The package a path under node_modules belongs to and the file's path
// inside it, read off the last node_modules segment.
function installedPackageFile(
  file: string
): {name: string; inner: string} | undefined {
  const parts = file.split(/[\\/]/)
  const at = parts.lastIndexOf('node_modules')
  if (at === -1) return undefined

  const scoped = parts[at + 1]?.startsWith('@')
  const name = parts.slice(at + 1, at + (scoped ? 3 : 2)).join('/')
  const inner = parts.slice(at + (scoped ? 3 : 2))

  return name && inner.length > 0 ? {name, inner: inner.join('/')} : undefined
}

function isInsideDir(file: string, dir: string): boolean {
  const relative = path.relative(dir, file)

  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

// Resolves a specifier the way the build does, through the bundler's own
// resolver and the resolve block the build was given.
export function createLocalImportResolver(
  projectPath: string
): LocalImportResolver {
  type Factory = InstanceType<
    typeof rspack.experiments.resolver.ResolverFactory
  >
  const build = buildResolveByProject.get(projectPath)
  let factory: Factory | null | undefined
  let dependencyFactories: Factory[] | undefined
  let sourceRoots: string[] | undefined
  let linked: LinkedDependency[] | undefined

  const createFactory = (resolve: BuildResolve | undefined): Factory =>
    new rspack.experiments.resolver.ResolverFactory(
      buildResolverOptions(projectPath, resolve)
    )

  const getFactory = (): Factory | null => {
    if (factory !== undefined) return factory

    try {
      factory = createFactory(build?.resolve)
    } catch {
      // A resolve block this resolver cannot take still leaves tsconfig paths.
      try {
        factory = createFactory(undefined)
      } catch {
        factory = null
      }
    }

    return factory
  }

  // One resolver per dependency kind the build gives a block of its own,
  // for a specifier the block alone does not resolve.
  const getDependencyFactories = (): Factory[] => {
    if (dependencyFactories) return dependencyFactories

    dependencyFactories = []

    for (const kind of DEPENDENCY_KINDS) {
      const resolve = resolveForDependency(build?.resolve, kind)
      if (!resolve) continue

      try {
        dependencyFactories.push(createFactory(resolve))
      } catch {
        // Ignore, a block this resolver cannot take resolves nothing more
      }
    }

    return dependencyFactories
  }

  const resolveWith = (
    resolver: Factory | null,
    fromFile: string,
    specifier: string
  ): string | undefined => {
    try {
      return resolver?.sync(path.dirname(fromFile), specifier)?.path
    } catch {
      return undefined
    }
  }

  // The project and the workspace it belongs to, where a linked package's
  // own source lives.
  const getSourceRoots = (): string[] => {
    if (sourceRoots) return sourceRoots

    const workspaceRoot =
      findPnpmWorkspaceRoot(projectPath) ??
      findPackageJsonWorkspaceRoot(projectPath)

    sourceRoots = [projectPath, ...(workspaceRoot ? [workspaceRoot] : [])].map(
      canonicalizeDir
    )

    return sourceRoots
  }

  // The folders the project or its workspace root links by path, which
  // may sit outside both.
  const getLinked = (): LinkedDependency[] => {
    linked ??= [...new Set([projectPath, ...getSourceRoots()])].flatMap(
      linkedDependencies
    )

    return linked
  }

  // A file: dependency the package manager copied under node_modules. It
  // is followed when the same file sits in the folder the project names.
  const copiedSource = (real: string): string | undefined => {
    const installed = installedPackageFile(real)
    if (!installed) return undefined

    return getLinked().some(
      (dependency) =>
        dependency.mayBeCopied &&
        dependency.name === installed.name &&
        readIfFile(path.join(dependency.dir, installed.inner)) !== undefined
    )
      ? real
      : undefined
  }

  // A workspace package linked under node_modules is the author's own
  // source, a real install is not. The real path tells them apart.
  const linkedSource = (file: string): string | undefined => {
    const real = fs.realpathSync.native(file)
    if (NODE_MODULES_SEGMENT.test(real)) return copiedSource(real)
    if (real === file) return undefined
    if (getSourceRoots().some((root) => isInsideDir(real, root))) return real

    // Outside the workspace only a folder a dependency names is followed.
    return getLinked().some((dependency) => isInsideDir(real, dependency.dir))
      ? real
      : undefined
  }

  const resolveImport = (fromFile: string, specifier: string) => {
    try {
      // The block alone answers first, as it always has. A dependency
      // kind is asked only for what that leaves unresolved.
      const file =
        resolveWith(getFactory(), fromFile, specifier) ??
        getDependencyFactories()
          .map((resolver) => resolveWith(resolver, fromFile, specifier))
          .find(Boolean)
      if (!file || !SCRIPT_SOURCE.test(file)) return undefined

      return NODE_MODULES_SEGMENT.test(file) ? linkedSource(file) : file
    } catch {
      return undefined
    }
  }

  return Object.assign(resolveImport, {scope: build?.scope ?? projectPath})
}

// Every local file the entries reach through imports, entries included,
// breadth first. Each file is asked once for the files it imports.
export function walkLocalImportGraph(
  entries: string[],
  importsOf: (file: string) => string[]
): string[] {
  const seen = new Set<string>()
  let level = entries

  for (
    let depth = 0;
    depth <= MAX_LOCAL_IMPORT_DEPTH && level.length > 0;
    depth++
  ) {
    const next: string[] = []

    for (const file of level) {
      if (seen.has(file) || seen.size >= MAX_LOCAL_IMPORT_FILES) continue

      seen.add(file)

      // The deepest file is still read, only its own imports are left.
      const imports = importsOf(file)
      if (depth < MAX_LOCAL_IMPORT_DEPTH) next.push(...imports)
    }

    level = next
  }

  return [...seen]
}

// Inline scripts plus the local script graph of every <script src> a page loads.
export function scanPageScripts(
  htmlAbsPath: string,
  projectDir: string,
  collect: (source: string) => string[]
): string[] {
  const html = readIfFile(htmlAbsPath)
  if (html === undefined) return []

  const found = collect(html)

  for (const match of html.matchAll(SCRIPT_SRC_PATTERN)) {
    const src = String(match[1] || '')
    if (/^(https?:)?\/\//i.test(src)) continue

    const scriptAbs = src.startsWith('/')
      ? path.join(projectDir, src.slice(1))
      : path.resolve(path.dirname(htmlAbsPath), src)
    found.push(...scanScriptGraph(scriptAbs, collect))
  }

  return found
}

// A page path named in an API call resolves against the extension root. Keyed
// by that path, so the emitted page sits at the URL the browser asks for.
export function rootRelativePages(
  literals: string[],
  projectDir: string
): Record<string, string> {
  const pages: Record<string, string> = {}

  for (const literal of literals) {
    const rootRel = literal.replace(/^\.?\/+/, '').split(/[?#]/)[0]
    if (!rootRel || !/\.html?$/i.test(rootRel)) continue

    const absPage = path.join(projectDir, rootRel)
    const relToProject = path.relative(projectDir, absPage)
    if (!relToProject || relToProject.startsWith('..')) continue
    if (!fs.existsSync(absPage)) continue

    const key = rootRel.replace(/\.html?$/i, '').replace(/\\/g, '/')
    pages[key] = absPage
  }

  return pages
}
