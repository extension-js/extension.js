//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// A template directory can be a working checkout: this repo runs `dev` inside
// the bundled one, and a new project must never inherit that build output or
// the session state beside it. Nor its history: a copied `.git` would hand the
// new project the template's commits and its remote.
export const NEVER_SCAFFOLDED_DIRS = [
  'dist',
  'node_modules',
  '.extension-js',
  '.git'
]

// A link a template carries is kept only when it resolves inside the
// template. One that reaches out of it would carry every later write to
// package.json or README.md to wherever the template author pointed it.
async function linkTargetInside(
  linkPath: string,
  root: string
): Promise<string | null> {
  let real: string

  try {
    real = await fs.realpath(linkPath)
  } catch {
    return null
  }

  const relative = path.relative(root, real)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return real
}

// The path a dropped link is named by, with forward slashes on every platform.
function templateRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
}

async function recreateLink(
  sourcePath: string,
  destPath: string,
  real: string
): Promise<void> {
  const target = path.relative(path.dirname(sourcePath), real) || '.'

  try {
    await fs.symlink(target, destPath)
  } catch (caught) {
    const err = caught as NodeJS.ErrnoException | undefined

    if (err?.code === 'EPERM' || err?.code === 'ENOTSUP') {
      await fs.cp(real, destPath, {recursive: true})
    } else {
      throw err
    }
  }
}

// Answers the links it left behind, relative to the template root.
export async function copyDirectoryWithSymlinks(
  source: string,
  destination: string,
  root?: string
): Promise<string[]> {
  const templateRoot = root ?? (await fs.realpath(source))
  const dropped: string[] = []
  const entries = await fs.readdir(source, {withFileTypes: true})
  await fs.mkdir(destination, {recursive: true})

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      if (NEVER_SCAFFOLDED_DIRS.includes(entry.name)) continue

      dropped.push(
        ...(await copyDirectoryWithSymlinks(sourcePath, destPath, templateRoot))
      )
    } else if (entry.isSymbolicLink()) {
      const real = await linkTargetInside(sourcePath, templateRoot)

      if (!real) {
        dropped.push(templateRelative(templateRoot, sourcePath))
        continue
      }

      await recreateLink(sourcePath, destPath, real)
    } else {
      await fs.copyFile(sourcePath, destPath)
    }
  }

  return dropped
}

export async function moveDirectoryContents(
  source: string,
  destination: string,
  root?: string
): Promise<string[]> {
  const templateRoot = root ?? (await fs.realpath(source))
  const dropped: string[] = []
  await fs.mkdir(destination, {recursive: true})

  const entries = await fs.readdir(source, {withFileTypes: true})

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      dropped.push(
        ...(await moveDirectoryContents(sourcePath, destPath, templateRoot))
      )
    } else if (entry.isSymbolicLink()) {
      const real = await linkTargetInside(sourcePath, templateRoot)

      if (!real) {
        dropped.push(templateRelative(templateRoot, sourcePath))
        continue
      }

      await recreateLink(sourcePath, destPath, real)
    } else {
      // Move files with EXDEV (cross-device) fallback to copy+unlink
      try {
        await fs.rename(sourcePath, destPath)
      } catch (caught) {
        const err = caught as NodeJS.ErrnoException | undefined

        if (err && (err.code === 'EXDEV' || err.code === 'EINVAL')) {
          await fs.copyFile(sourcePath, destPath)
          await fs.rm(sourcePath, {force: true})
        } else {
          throw err
        }
      }
    }
  }

  await fs.rm(source, {recursive: true, force: true})

  return dropped
}

// A path printed as a command is pasted into a shell, so anything outside the
// plain shell-safe set travels single-quoted with its own quotes escaped.
const SHELL_SAFE_PATH = /^[A-Za-z0-9_@%+=:,./-]+$/
const SINGLE_QUOTE = String.fromCharCode(39)

export function shellQuote(value: string) {
  if (SHELL_SAFE_PATH.test(value)) return value

  const escaped = value
    .split(SINGLE_QUOTE)
    .join(`${SINGLE_QUOTE}\\${SINGLE_QUOTE}${SINGLE_QUOTE}`)

  return `${SINGLE_QUOTE}${escaped}${SINGLE_QUOTE}`
}

// Answers the cause instead of logging it: logging here printed a frame for
// the probe and let the caller print a second one for the destination.
export async function directoryWriteFailure(
  directory: string
): Promise<NodeJS.ErrnoException | null> {
  try {
    await fs.mkdir(directory, {recursive: true})

    return null
  } catch (err) {
    return err as NodeJS.ErrnoException
  }
}

export function isTypeScriptTemplate(templateName: string) {
  return (
    templateName.includes('typescript') ||
    templateName.includes('react') ||
    templateName.includes('preact') ||
    templateName.includes('svelte') ||
    templateName.includes('solid')
  )
}

// The name list misses every template that is TypeScript without saying so:
// vue, the ai ones, playwright. A scaffolded tsconfig is the honest signal,
// and without it the first dev run writes the types file and says so.
export async function scaffoldNeedsTypeDefinitions(
  projectPath: string,
  templateName: string
) {
  if (isTypeScriptTemplate(templateName)) return true

  try {
    await fs.access(path.join(projectPath, 'tsconfig.json'))

    return true
  } catch {
    return false
  }
}
