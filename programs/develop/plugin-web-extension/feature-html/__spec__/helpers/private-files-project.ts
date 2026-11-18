import * as fs from 'node:fs'
import * as path from 'node:path'
import {vi} from 'vitest'
import {
  MARKER,
  project
} from '../../../../plugin-special-folders/__spec__/helpers/private-files-project'

export {
  canLink,
  MARKER,
  manifest,
  PAGE
} from '../../../../plugin-special-folders/__spec__/helpers/private-files-project'

// The shared fixture project of fake private files, plus dot-named files in
// public/ that a build ships, and a build that reads a failed run as well.

export const PUBLIC_FILES = {
  'public/.well-known/links.json': '[]',
  'public/.env.example': 'PRIVATE_KEY=\n',
  'public/logo.png': 'png'
}

export const PUBLIC_OUTPUT = [
  '.env.example',
  '.well-known/links.json',
  'logo.png'
]

export interface Project {
  root: string
  // A file one folder above the project, which no build should reach.
  outsideFile: string
}

export function makeProject(files: Record<string, string> = {}): Project {
  const root = project({...PUBLIC_FILES, ...files})

  return {root, outsideFile: path.join(path.dirname(root), 'outside.txt')}
}

function listOutput(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    const name = `${prefix}${entry.name}`

    if (entry.isDirectory()) Object.assign(out, listOutput(full, `${name}/`))
    else out[name] = fs.readFileSync(full, 'utf-8')
  }

  return out
}

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

// A bundled asset carries a content hash in its name.
const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

export interface Built {
  // Every file in the output folder but the page and the manifest.
  shipped: string[]
  // The files that carry a marker, which no build should hold.
  marked: string[]
  // The refs a page warning names as missing.
  missing: string[]
  // The built pages that hold the text "own page".
  pages: string[]
  // The paths a finding shows after NOT FOUND.
  notFound: string[]
  printed: string
  errors: number
}

export async function buildProject(
  root: string,
  browser: 'chrome' | 'firefox' = 'chrome'
): Promise<Built> {
  const {extensionBuild} = await import('../../../../command-build')
  const lines: string[] = []

  const keep = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '))
  }

  const write = (chunk: unknown) => {
    lines.push(String(chunk))

    return true
  }

  const spies = [
    vi.spyOn(console, 'log').mockImplementation(keep),
    vi.spyOn(console, 'info').mockImplementation(keep),
    vi.spyOn(console, 'warn').mockImplementation(keep),
    vi.spyOn(console, 'error').mockImplementation(keep),
    vi.spyOn(process.stdout, 'write').mockImplementation(write),
    vi.spyOn(process.stderr, 'write').mockImplementation(write)
  ]
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    let summary: {errors_count?: number} | undefined
    let failure: {diagnostics?: unknown[]} | undefined

    try {
      summary = await extensionBuild(root, {
        browser,
        silent: false,
        install: false,
        mode: 'production',
        exitOnError: false
      } as never)
    } catch (error) {
      // A build with an error rejects, and writes nothing.
      failure = error as {diagnostics?: unknown[]}
    }

    const failedWith = failure?.diagnostics?.filter(
      (finding) => (finding as {severity?: string}).severity === 'error'
    ).length
    const out = listOutput(path.join(root, 'dist', browser))
    const printed = [
      lines.join('\n'),
      JSON.stringify(summary ?? failure?.diagnostics)
    ]
      .join('\n')
      .replace(ANSI, '')
    const missing = new Set<string>()
    const notFound = new Set<string>()

    for (const match of printed.matchAll(/Update the (\S+) reference to/g)) {
      missing.add(match[1])
    }

    for (const match of lines
      .join('\n')
      .replace(ANSI, '')
      .matchAll(/NOT FOUND (\S+)/g)) {
      notFound.add(match[1])
    }

    return {
      shipped: Object.keys(out)
        .filter((name) => !/^(?:action\/index\.\w+|manifest\.json)$/.test(name))
        .map(withoutHash)
        .sort(),
      marked: Object.keys(out)
        .filter((name) => out[name].includes(MARKER))
        .map(withoutHash)
        .sort(),
      pages: Object.keys(out)
        .filter((name) => out[name].includes('own page'))
        .sort(),
      missing: [...missing].sort(),
      notFound: [...notFound].sort(),
      printed,
      errors: Number(summary?.errors_count ?? failedWith ?? -1)
    }
  } finally {
    for (const spy of spies) spy.mockRestore()

    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}
