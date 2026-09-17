//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import semver from 'semver'

export const CLI_PACKAGES = ['extension', 'extension-develop'] as const

const LOCKFILE_COMMANDS: Array<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm install'],
  ['yarn.lock', 'yarn install'],
  ['bun.lock', 'bun install'],
  ['bun.lockb', 'bun install'],
  ['deno.lock', 'deno install'],
  ['package-lock.json', 'npm install']
]

export function installCommandFor(files: string[]): string {
  for (const [lockfile, command] of LOCKFILE_COMMANDS) {
    if (files.includes(lockfile)) return command
  }

  return 'npm install'
}

export interface ProjectManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface DeclaredCli {
  name: string
  range: string
}

export interface VersionMismatch {
  declared: string
  range: string
  running: string
}

export function declaredCliDependency(
  manifest: ProjectManifest | null
): DeclaredCli | null {
  for (const field of [manifest?.dependencies, manifest?.devDependencies]) {
    for (const name of CLI_PACKAGES) {
      const range = field?.[name]

      if (typeof range === 'string' && range.length > 0) {
        return {name, range}
      }
    }
  }

  return null
}

// A workspace, file, link or git range names a checkout, not a published
// version, so there is no number to compare and nothing to warn about.
export function isComparableRange(range: string): boolean {
  const trimmed = range.trim()

  if (!trimmed || trimmed === '*' || trimmed === 'latest') return false
  if (/^(workspace|file|link|git|github|npm):/i.test(trimmed)) return false
  if (/^[./]/.test(trimmed)) return false

  return semver.validRange(trimmed) !== null
}

export function versionMismatch(input: {
  manifest: ProjectManifest | null
  running: string
}): VersionMismatch | null {
  const declared = declaredCliDependency(input.manifest)

  if (!declared) return null
  if (!isComparableRange(declared.range)) return null
  if (!semver.valid(input.running)) return null

  if (
    semver.satisfies(input.running, declared.range, {includePrerelease: true})
  ) {
    return null
  }

  return {
    declared: declared.name,
    range: declared.range,
    running: input.running
  }
}

export function readProjectManifest(
  projectPath: string
): ProjectManifest | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
    ) as ProjectManifest
  } catch {
    return null
  }
}

export interface ProjectCliVersionCheck extends VersionMismatch {
  command: string
}

export function checkProjectCliVersion(
  projectPath: string,
  running: string
): ProjectCliVersionCheck | null {
  let files: string[] = []

  try {
    files = fs.readdirSync(projectPath)
  } catch {
    return null
  }

  if (!files.includes('package.json')) return null

  const mismatch = versionMismatch({
    manifest: readProjectManifest(projectPath),
    running
  })

  if (!mismatch) return null

  return {...mismatch, command: installCommandFor(files)}
}
