// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {AddonLintLine} from './addon-lint'
import {type ChunkProvenance, chunkFileOf} from './chunk-dependency-provenance'

// Next to the browser folder, never inside it: dist/<browser> is the package
// that ships, and a note to reviewers is not part of the add-on.
export const ADDON_REVIEWER_NOTE_FILE = 'amo-reviewer-note.md'

// A finding that names a browser API is the author's: no library calls
// chrome.offscreen, whatever else the same file bundles.
export const AUTHOR_ONLY_CODES = new Set(['UNSUPPORTED_API'])

export interface PackageFacts {
  version: string | null
  license: string | null
}

export interface ReviewerNotePackage extends PackageFacts {
  name: string
  // Lines the package may account for, keyed by chunk file, with whether that
  // file also carries the author's own modules.
  findings: Array<{line: AddonLintLine; mixed: boolean}>
}

export interface ReviewerNote {
  packages: ReviewerNotePackage[]
  own: AddonLintLine[]
}

function licenseOf(packageJson: Record<string, unknown>): string | null {
  const license = packageJson.license

  if (typeof license === 'string' && license.trim()) return license.trim()

  if (license && typeof license === 'object') {
    const type = (license as {type?: unknown}).type

    if (typeof type === 'string' && type.trim()) return type.trim()
  }

  const licenses = packageJson.licenses

  if (Array.isArray(licenses)) {
    const types = licenses
      .map((entry) => (entry as {type?: unknown})?.type)
      .filter((type): type is string => typeof type === 'string' && !!type)

    if (types.length > 0) return types.join(' OR ')
  }

  return null
}

function* ancestors(start: string): Generator<string> {
  let dir = path.resolve(start)

  while (true) {
    yield dir
    const parent = path.dirname(dir)
    if (parent === dir) return

    dir = parent
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The installed copy is what the bundle carried, so it wins over the
// lockfile, and it is the only place a license is written down.
function installedPackageFacts(
  projectPath: string,
  name: string
): PackageFacts | null {
  for (const dir of ancestors(projectPath)) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json')
    if (!fs.existsSync(candidate)) continue

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      const version = typeof parsed.version === 'string' ? parsed.version : null

      return {version, license: licenseOf(parsed)}
    } catch {
      return null
    }
  }

  return null
}

function versionFromNpmLock(content: string, name: string): string | null {
  try {
    const lock = JSON.parse(content)
    const packages = lock?.packages

    if (packages && typeof packages === 'object') {
      const entry = Object.entries(packages).find(([key]) =>
        key.endsWith(`node_modules/${name}`)
      )
      const version = (entry?.[1] as {version?: unknown})?.version

      if (typeof version === 'string') return version
    }

    const version = lock?.dependencies?.[name]?.version

    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

// pnpm spelled the package key three ways across lockfile versions:
// `/name/1.0.0:`, `/name@1.0.0:` and `name@1.0.0:`, the last optionally quoted.
function versionFromPnpmLock(content: string, name: string): string | null {
  const key = escapeRegExp(name)
  const match = content.match(
    new RegExp(`^  '?/?${key}[@/](\\d[^'()\\s:]*)`, 'm')
  )

  return match ? match[1] : null
}

function versionFromYarnLock(content: string, name: string): string | null {
  const key = escapeRegExp(name)
  const match = content.match(
    new RegExp(
      `^"?${key}@[^\\n]*:\\n(?:[^\\n]*\\n)*?\\s+version:? "?([^"\\n]+)"?`,
      'm'
    )
  )

  return match ? match[1] : null
}

const LOCKFILE_READERS: Array<
  [string, (content: string, name: string) => string | null]
> = [
  ['package-lock.json', versionFromNpmLock],
  ['npm-shrinkwrap.json', versionFromNpmLock],
  ['pnpm-lock.yaml', versionFromPnpmLock],
  ['yarn.lock', versionFromYarnLock]
]

export function lockfilePackageVersion(
  projectPath: string,
  name: string
): string | null {
  for (const dir of ancestors(projectPath)) {
    for (const [file, read] of LOCKFILE_READERS) {
      const candidate = path.join(dir, file)
      if (!fs.existsSync(candidate)) continue

      try {
        return read(fs.readFileSync(candidate, 'utf8'), name)
      } catch {
        return null
      }
    }
  }

  return null
}

export function packageFacts(projectPath: string, name: string): PackageFacts {
  const installed = installedPackageFacts(projectPath, name)

  return {
    version: installed?.version ?? lockfilePackageVersion(projectPath, name),
    license: installed?.license ?? null
  }
}

// A finding lands under every package its file bundles: the engine knows the
// file's packages, not which one wrote the flagged line, and the note says
// when a file also carries the author's code. An API-name finding and any
// finding in a file with no bundled dependency is the author's own.
export function classifyAddonLintLines(
  lines: AddonLintLine[],
  chunkProvenance: Map<string, ChunkProvenance> | undefined,
  readFacts: (name: string) => PackageFacts
): ReviewerNote {
  const byPackage = new Map<string, ReviewerNotePackage>()
  const own: AddonLintLine[] = []

  for (const line of lines) {
    const provenance = AUTHOR_ONLY_CODES.has(line.code)
      ? undefined
      : chunkProvenance?.get(chunkFileOf(line.location))

    if (!provenance || provenance.packages.length === 0) {
      own.push(line)

      continue
    }

    for (const name of provenance.packages) {
      const entry = byPackage.get(name) ?? {
        name,
        ...readFacts(name),
        findings: []
      }
      entry.findings.push({line, mixed: !provenance.onlyDependencies})
      byPackage.set(name, entry)
    }
  }

  return {
    packages: [...byPackage.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    own
  }
}

function findingText(line: AddonLintLine): string {
  const where = line.location ? ` (${line.location})` : ''

  return `${line.code}: ${line.message}${where}`
}

export function renderAddonReviewerNote(
  note: ReviewerNote,
  distDisplay: string
): string {
  const out: string[] = [
    '# Notes to reviewer',
    '',
    `Written by Extension.js from the addons-linter run over ${distDisplay}. ` +
      'Paste the bundled libraries section into the notes to reviewer field of the addons.mozilla.org submission.',
    ''
  ]

  out.push('## Bundled libraries', '')

  if (note.packages.length === 0) {
    out.push('No bundled library accounts for a finding in this build.', '')
  }

  for (const pkg of note.packages) {
    const version =
      pkg.version ?? 'version not found in node_modules or a lockfile'
    const license = pkg.license ?? 'license not found in its package.json'

    out.push(
      `### ${pkg.name} ${version}`,
      '',
      `${pkg.name} ${version} (${license}) is unmodified from npm. It accounts for:`,
      ''
    )

    for (const {line, mixed} of pkg.findings) {
      const hedge = mixed
        ? ' (this file also carries the extension author code, confirm before pasting)'
        : ''
      out.push(`- ${findingText(line)}${hedge}`)
    }

    out.push('')
  }

  out.push(
    '## Findings in the extension author code',
    '',
    'These are not library noise and must not be presented as such.',
    ''
  )

  if (note.own.length === 0) {
    out.push('None.', '')
  }

  for (const line of note.own) {
    out.push(`- ${findingText(line)}`)
  }

  if (note.own.length > 0) out.push('')

  return out.join('\n')
}

export function addonReviewerNotePath(distPath: string): string {
  return path.join(
    path.dirname(path.resolve(distPath)),
    ADDON_REVIEWER_NOTE_FILE
  )
}

export interface WriteAddonReviewerNoteInput {
  projectPath: string
  distPath: string
  distDisplay: string
  lines: AddonLintLine[]
  chunkProvenance?: Map<string, ChunkProvenance>
}

// A build with nothing to report removes an earlier note, so the file never
// describes a package other than the one in the browser folder beside it.
export function writeAddonReviewerNote(
  input: WriteAddonReviewerNoteInput
): string | null {
  const target = addonReviewerNotePath(input.distPath)

  if (input.lines.length === 0) {
    fs.rmSync(target, {force: true})

    return null
  }

  const note = classifyAddonLintLines(
    input.lines,
    input.chunkProvenance,
    (name) => packageFacts(input.projectPath, name)
  )

  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(
    target,
    renderAddonReviewerNote(note, input.distDisplay),
    'utf8'
  )

  return target
}
