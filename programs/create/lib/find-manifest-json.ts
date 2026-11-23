//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {describeJsonReadFailure} from './json-parse-position'
import * as messages from './messages'
import {CODES} from './messaging'
import {CreateError, failStep} from './utils'

const manifestSearchMaxDepth = 3
const ignoredManifestDirs = new Set(['node_modules', '.git'])

export async function findManifestJsonPath(
  projectPath: string
): Promise<string> {
  const candidates = [
    path.join(projectPath, 'manifest.json'),
    path.join(projectPath, 'src', 'manifest.json'),
    path.join(projectPath, 'extension', 'manifest.json'),
    path.join(projectPath, 'extension', 'src', 'manifest.json')
  ]

  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate)

      return candidate
    } catch {
      // Ignore
    }
  }

  const queue: Array<{dir: string; depth: number}> = [
    {dir: projectPath, depth: 0}
  ]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    let entries: Array<fs.Dirent>

    try {
      entries = await fs.promises.readdir(current.dir, {withFileTypes: true})
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'manifest.json') {
        return path.join(current.dir, entry.name)
      }

      if (
        entry.isDirectory() &&
        current.depth < manifestSearchMaxDepth &&
        !ignoredManifestDirs.has(entry.name)
      ) {
        queue.push({
          dir: path.join(current.dir, entry.name),
          depth: current.depth + 1
        })
      }
    }
  }

  // A web-only template with no manifest is a legal input, so this refusal
  // travels framed on the error instead of reaching the user as a stack.
  throw new CreateError(
    messages.manifestNotFound(projectPath, manifestSearchMaxDepth),
    CODES.E_TEMPLATE_NOT_FOUND
  )
}

// Both scaffold steps that personalize the manifest read it the same way, so
// an absent and an unparseable file refuse through one framed path.
export async function readManifestJson(projectPath: string): Promise<{
  manifestJsonPath: string
  manifestJson: Record<string, unknown>
}> {
  const manifestJsonPath = await findManifestJsonPath(projectPath)
  let raw: string | undefined

  try {
    raw = await fs.promises.readFile(manifestJsonPath, 'utf-8')

    return {manifestJsonPath, manifestJson: JSON.parse(raw)}
  } catch (error) {
    const reason = describeJsonReadFailure(error, raw)

    throw failStep(
      messages.manifestNotParseable(manifestJsonPath, reason),
      contentFreeCause(error, raw, reason),
      CODES.E_TEMPLATE_NOT_FOUND
    )
  }
}

// Node's parse message quotes the file, so a parse failure travels as the
// position alone and a read failure keeps its own error.
function contentFreeCause(
  error: unknown,
  text: string | undefined,
  reason: string
): unknown {
  return text === undefined ? error : new SyntaxError(reason)
}

// Every step that reads the scaffold's package.json reads it here, so a broken
// one is refused the same way everywhere. Only a missing file answers nothing.
export function readTemplatePackageJson(
  projectPath: string
): Record<string, unknown> | undefined {
  const packageJsonPath = path.join(projectPath, 'package.json')
  let raw: string | undefined
  let parsed: unknown

  try {
    raw = fs.readFileSync(packageJsonPath, 'utf8')
    parsed = JSON.parse(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined

    const reason = describeJsonReadFailure(error, raw)

    throw failStep(
      messages.templatePackageJsonNotParseable(packageJsonPath, reason),
      contentFreeCause(error, raw, reason),
      CODES.E_TEMPLATE_NOT_FOUND
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const reason = 'it does not hold a JSON object'

    throw failStep(
      messages.templatePackageJsonNotParseable(packageJsonPath, reason),
      new TypeError(reason),
      CODES.E_TEMPLATE_NOT_FOUND
    )
  }

  return parsed as Record<string, unknown>
}
