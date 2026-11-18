// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
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

// `.env.<anything>` is an env file, except the template a project commits to
// document its keys, which holds no value worth hiding.
const ENV_VARIANT_PREFIX = '.env.'
const ENV_TEMPLATE_SUFFIX = 'example'

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

export function privateFileKind(name: string): PrivateFileKind | undefined {
  const lower = name.toLowerCase()

  if (lower.startsWith(ENV_VARIANT_PREFIX)) {
    return lower === ENV_VARIANT_PREFIX + ENV_TEMPLATE_SUFFIX
      ? undefined
      : 'env'
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

// A glob has no "all but this name", so every `.env.<suffix>` other than the
// template is spelled out: a first differing letter, a shorter or longer name.
function envVariantGlobs(): string[] {
  const prefix = anyCase(ENV_VARIANT_PREFIX)
  const globs: string[] = []

  for (let index = 0; index < ENV_TEMPLATE_SUFFIX.length; index += 1) {
    const shared = prefix + anyCase(ENV_TEMPLATE_SUFFIX.slice(0, index))
    const letter = ENV_TEMPLATE_SUFFIX[index]

    globs.push(shared, `${shared}[!${letter}${letter.toUpperCase()}]*`)
  }

  globs.push(`${prefix}${anyCase(ENV_TEMPLATE_SUFFIX)}?*`)

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
