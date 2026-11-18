// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Why a name under public/ never ships. An env file is the one kind a project
// put there on purpose, so it alone is named in a warning.
export type PrivateFileKind = 'os' | 'env' | 'tooling'

// Whole names of a file or a folder, matched in any letter case. `*` stands
// for any run of characters. Dot-files not listed here ship as authored.
const PRIVATE_NAMES: Array<[PrivateFileKind, string]> = [
  ['os', '.DS_Store'],
  ['os', 'Thumbs.db'],
  ['os', 'desktop.ini'],
  ['env', '.env'],
  ['env', '.envrc'],
  ['tooling', '.git'],
  ['tooling', '.gitignore'],
  ['tooling', '.gitattributes'],
  ['tooling', '.gitmodules'],
  ['tooling', '.gitkeep'],
  ['tooling', '.npmrc'],
  ['tooling', '.yarnrc.yml'],
  ['tooling', '.*.swp'],
  ['tooling', '.*.swo'],
  ['tooling', '.*.swn'],
  ['tooling', '*~']
]

// `.env.<anything>` is an env file, except a template a project commits to
// document its keys. By convention it holds no value worth hiding.
const ENV_VARIANT_PREFIX = '.env.'
const ENV_TEMPLATE_ENDINGS = ['.example', '.sample', '.template']

const GLOB_SPECIAL = /[[\]{}()*?]/g

function escapeGlob(literal: string): string {
  return literal.replace(GLOB_SPECIAL, (char) => `[${char}]`)
}

// The copier matches letter case exactly, so each letter becomes a class.
function anyCase(literal: string): string {
  return literal.replace(/[a-z]|[[\]{}()?]/gi, (char) => {
    const lower = char.toLowerCase()
    const upper = char.toUpperCase()

    return lower === upper ? `[${char}]` : `[${lower}${upper}]`
  })
}

function nameToRegExp(name: string): RegExp {
  const body = name
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')

  return new RegExp(`^${body}$`, 'i')
}

const PRIVATE_MATCHERS = PRIVATE_NAMES.map(
  ([kind, name]) => [kind, nameToRegExp(name)] as const
)

// True for `.env.example`, `.env.sample`, `.env.template` and any longer
// `.env.*` name with one of those endings, in any letter case.
export function isEnvTemplateFileName(name: string): boolean {
  const lower = name.toLowerCase()

  return (
    lower.startsWith(ENV_VARIANT_PREFIX) &&
    ENV_TEMPLATE_ENDINGS.some((ending) => lower.endsWith(ending))
  )
}

export function privateFileKind(name: string): PrivateFileKind | undefined {
  if (name.toLowerCase().startsWith(ENV_VARIANT_PREFIX)) {
    return isEnvTemplateFileName(name) ? undefined : 'env'
  }

  for (const [kind, matcher] of PRIVATE_MATCHERS) {
    if (matcher.test(name)) return kind
  }

  return undefined
}

// A path with one of these names anywhere along it, a folder included. The
// path is relative and may use either separator.
export function hasPrivateFileName(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]+/)
    .some((name) => privateFileKind(name) !== undefined)
}

// The name as written and as the browser reads it, where `%2e%2e` is `..`.
export function browserSpellings(outputName: string): string[] {
  const spellings = [outputName]

  try {
    spellings.push(decodeURIComponent(outputName))
  } catch {
    // Not a valid escape, so the browser asks for the name as written.
  }

  return spellings.map((spelling) =>
    path.posix.normalize(spelling.replace(/\\/g, '/'))
  )
}

// A normalized name that leaves the extension root.
export function climbsOut(normalized: string): boolean {
  return normalized === '..' || normalized.startsWith('../')
}

// Whether a root-absolute URL is refused as written, before any file is
// looked up: it climbs out of the extension root or carries a private name.
// The path is the URL's and never the machine's: `/abs/x.txt` is `abs/x.txt`.
export function rootAbsolutePathIsWithheld(ref: string): boolean {
  return browserSpellings(ref.replace(/^\/+/, '')).some(
    (name) => climbsOut(name) || hasPrivateFileName(name)
  )
}

// How the build came to a source path. `named`: the author wrote the path
// of this one file. `walked`: a folder entry or a pattern reached it.
export type SourceAsk = 'named' | 'walked'

function isNodeModules(name: string): boolean {
  return name.toLowerCase() === 'node_modules'
}

// A path from a project root to something the project holds: it stays below
// the root and carries no private name. Only a named file enters a package.
function isProjectContentPath(relativePath: string, ask: SourceAsk): boolean {
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !hasPrivateFileName(relativePath) &&
    (ask === 'named' || !relativePath.split(/[\\/]+/).some(isNodeModules))
  )
}

// A package manager links a package to its store, which a workspace keeps
// in the `node_modules` of a folder above the project.
function isInAncestorNodeModules(relativePath: string): boolean {
  if (path.isAbsolute(relativePath)) return false

  const names = relativePath.split(/[\\/]+/)
  const below = names.findIndex((name) => name !== '..')

  return (
    below > 0 &&
    below < names.length - 1 &&
    isNodeModules(names[below]) &&
    !names.slice(below).some((name) => privateFileKind(name) !== undefined)
  )
}

function isBelow(relativePath: string): boolean {
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

// A file the workspace shares with its packages: below the workspace root,
// through no dot-folder and no `node_modules` of another package.
function isWorkspaceSharedPath(fromWorkspace: string): boolean {
  return (
    isBelow(fromWorkspace) &&
    !fromWorkspace
      .split(/[\\/]+/)
      .some((name) => name.startsWith('.') || isNodeModules(name))
  )
}

const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const workspaceRoots = new Map<string, string>()

function realOrResolved(file: string): string {
  try {
    return fs.realpathSync(file)
  } catch {
    return path.resolve(file)
  }
}

// A `workspaces` field npm, Yarn and Bun read: a list of folders, or an
// object whose `packages` is that list.
function holdsWorkspaceMarker(dir: string): boolean {
  if (fs.existsSync(path.join(dir, WORKSPACE_FILE))) return true

  let workspaces: unknown

  try {
    const read = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    ) as {workspaces?: unknown} | null
    workspaces = read?.workspaces
  } catch {
    return false
  }

  return (
    Array.isArray(workspaces) ||
    (typeof workspaces === 'object' &&
      workspaces !== null &&
      Array.isArray((workspaces as {packages?: unknown}).packages))
  )
}

// The nearest folder at or above the project that declares a workspace. A
// marker in the home folder or above it is no workspace of this project.
export function workspaceRootOf(
  projectRoot: string,
  homeDir: string = os.homedir()
): string {
  const project = realOrResolved(projectRoot)
  const home = homeDir ? realOrResolved(homeDir) : ''
  const key = `${project}\n${home}`
  const cached = workspaceRoots.get(key)

  if (cached !== undefined) return cached

  const fromHome = home ? path.relative(home, project) : '..'
  const insideHome = fromHome === '' || isBelow(fromHome)
  let found = project
  let dir = project

  while (true) {
    if (insideHome && !isBelow(path.relative(home, dir))) break

    if (holdsWorkspaceMarker(dir)) {
      found = dir
      break
    }

    const parent = path.dirname(dir)
    if (parent === dir) break

    dir = parent
  }

  workspaceRoots.set(key, found)

  return found
}

function realPathOf(file: string): string | undefined {
  try {
    return fs.realpathSync(file)
  } catch {
    return undefined
  }
}

// Whether the build may copy a source file or folder into the output. Both
// the path as given and where a link leads must be project or workspace content.
export function sourceFileMayShip(
  sourcePath: string,
  projectRoots: string[],
  ask: SourceAsk = 'named'
): boolean {
  const given = path.resolve(sourcePath)
  const givenInside = projectRoots.some((root) => {
    const fromRoot = path.relative(path.resolve(root), given)

    if (isProjectContentPath(fromRoot, ask)) return true
    if (ask !== 'named' || hasPrivateFileName(fromRoot)) return false

    const realRoot = realPathOf(root)
    if (!realRoot) return false

    // The path as written, read from the real root, keeps its own names.
    const fromWorkspace = path.relative(
      workspaceRootOf(realRoot),
      path.resolve(realRoot, fromRoot)
    )

    return (
      isWorkspaceSharedPath(fromWorkspace) ||
      (isBelow(fromWorkspace) && isInAncestorNodeModules(fromRoot))
    )
  })
  if (!givenInside) return false

  const real = realPathOf(sourcePath)
  if (!real) return false

  return projectRoots.some((root) => {
    const realRoot = realPathOf(root)
    if (!realRoot) return false

    const fromRoot = path.relative(realRoot, real)

    if (isProjectContentPath(fromRoot, ask)) return true
    if (ask !== 'named') return false
    if (isInAncestorNodeModules(fromRoot)) return true

    return (
      !hasPrivateFileName(fromRoot) &&
      isWorkspaceSharedPath(path.relative(workspaceRootOf(realRoot), real))
    )
  })
}

// A glob has no "all but these endings", so every other `.env.<rest>` is
// spelled out by where its tail, read from the end, first leaves a template
// ending: at a letter no ending has there, or by running out of name.
function envVariantGlobs(): string[] {
  const prefix = anyCase(ENV_VARIANT_PREFIX)
  // A template ending without its dot, which the prefix already carries.
  const tails = ENV_TEMPLATE_ENDINGS.map((ending) => ending.slice(1))
  const shared = new Set<string>([''])

  for (const tail of tails) {
    for (let length = 1; length <= tail.length; length += 1) {
      shared.add(tail.slice(-length))
    }
  }

  const globs: string[] = []

  for (const end of shared) {
    const whole = tails.includes(end)
    const before = new Set<string>()

    for (const tail of tails) {
      if (tail !== end && tail.endsWith(end)) {
        before.add(tail[tail.length - end.length - 1])
      }
    }

    const letters = [...before]
      .map((letter) => letter + letter.toUpperCase())
      .join('')

    // A whole ending is a template when a dot comes before it.
    globs.push(`${prefix}*[!${letters}${whole ? '.' : ''}]${anyCase(end)}`)
    if (!whole) globs.push(prefix + anyCase(end))
  }

  return globs
}

// The ignore list for the public copier: each name wherever it sits under
// the folder, and everything inside a folder that carries one.
export function privateFileIgnoreGlobs(publicDir: string): string[] {
  const root = escapeGlob(publicDir.replace(/\\/g, '/'))
  const names = [
    ...PRIVATE_NAMES.map(([, name]) => name.split('*').map(anyCase).join('*')),
    ...envVariantGlobs()
  ]

  return names.flatMap((name) => [
    `${root}/**/${name}`,
    `${root}/**/${name}/**`
  ])
}

// The path of a file or folder as an ignore glob that matches it alone.
export function literalPathGlob(file: string): string {
  return escapeGlob(file.replace(/\\/g, '/'))
}

// Env files under public/, by their path inside it. A folder that carries a
// private name is listed (env) or passed over, and never walked.
export function findPublicEnvFiles(publicDir: string): string[] {
  const found: string[] = []

  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[] = []

    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      const kind = privateFileKind(entry.name)

      if (kind === 'env') {
        found.push(`${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`)
      } else if (!kind && entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      }
    }
  }

  walk(publicDir, '')

  return found.sort()
}

// Links under public/ the copier must not follow, by their path inside it: a
// link whose real place leaves the project or enters node_modules. A folder
// such a link names is listed with a trailing slash and never walked.
export function findPublicLinksLeftOut(
  publicDir: string,
  projectRoots: string[]
): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  const walk = (dir: string, prefix: string) => {
    let real: string

    try {
      real = fs.realpathSync(dir)
    } catch {
      return
    }

    // A link back to a folder already walked would walk it forever.
    if (seen.has(real)) return

    seen.add(real)

    let entries: fs.Dirent[] = []

    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      // The copier leaves these names out already.
      if (privateFileKind(entry.name)) continue

      const full = path.join(dir, entry.name)
      const name = `${prefix}${entry.name}`
      let isDir = entry.isDirectory()

      if (entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory()
        } catch {
          // A link to nothing copies nothing.
          continue
        }

        if (!sourceFileMayShip(full, projectRoots, 'walked')) {
          found.push(isDir ? `${name}/` : name)
          continue
        }
      }

      if (isDir) walk(full, `${name}/`)
    }
  }

  walk(publicDir, '')

  return found.sort()
}
