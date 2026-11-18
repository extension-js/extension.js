import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {vi} from 'vitest'

// A fixture project for whole builds: files a build should never copy sit
// beside the manifest, in an installed package and outside the project.

// Obvious fakes: no file here holds a real value.
export const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'
export const canLink = process.platform !== 'win32'

const holders: string[] = []

export function removeProjects() {
  for (const holder of holders.splice(0)) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
}

export const PAGE = '<!doctype html><html><head></head><body></body></html>'

export function manifest(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    manifest_version: 3,
    name: 'private-files',
    version: '1.0.0',
    action: {default_popup: 'popup.html'},
    ...extra
  })
}

export interface Project {
  root: string
  // A file one folder above the project, which no build should reach.
  outsideFile: string
}

// The project sits one folder down, so a climbing path has a file to reach.
export function makeProject(files: Record<string, string> = {}): Project {
  const holder = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-private-files-'))
  )
  holders.push(holder)

  const root = path.join(holder, 'project')
  const all: Record<string, string> = {
    '.env': `PRIVATE_KEY=${MARKER}-env\n`,
    '.env.local': `PRIVATE_KEY=${MARKER}-env-local\n`,
    '.envrc': `export PRIVATE_KEY=${MARKER}-envrc\n`,
    '.npmrc': `# ${MARKER}-npmrc\n`,
    '.git/config': `# ${MARKER}-git\n`,
    'package.json': JSON.stringify({
      name: 'private-files',
      version: '1.0.0',
      private: true
    }),
    'node_modules/pkg/data.json': `{"value":"${MARKER}-node-modules"}`,
    'a/keep.txt': 'keep',
    'data/ok.json': '{"ok":true}',
    'public/.well-known/links.json': '[]',
    'public/.env.example': 'PRIVATE_KEY=\n',
    'public/logo.png': 'png',
    'manifest.json': manifest(),
    'popup.html': PAGE,
    ...files
  }

  for (const [relative, contents] of Object.entries(all)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  const outsideFile = path.join(holder, 'outside.txt')
  fs.writeFileSync(outsideFile, `${MARKER}-outside\n`)
  fs.mkdirSync(path.join(holder, 'outside-folder'))
  fs.writeFileSync(
    path.join(holder, 'outside-folder', 'inner.txt'),
    `${MARKER}-outside-folder\n`
  )

  if (canLink) {
    fs.symlinkSync(outsideFile, path.join(root, 'linked.txt'))
    fs.symlinkSync(
      path.join(holder, 'outside-folder'),
      path.join(root, 'linked-folder')
    )
  }

  return {root, outsideFile}
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
  // The paths a finding shows after NOT FOUND.
  notFound: string[]
  printed: string
  errors: number
}

export async function buildProject(root: string): Promise<Built> {
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
        browser: 'chrome',
        silent: false,
        install: false,
        mode: 'production',
        exitOnError: false
      } as never)
    } catch (error) {
      // A build with an error rejects, and writes nothing.
      failure = error as {diagnostics?: unknown[]}
    }

    const out = listOutput(path.join(root, 'dist', 'chrome'))
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
      missing: [...missing].sort(),
      notFound: [...notFound].sort(),
      printed,
      errors: Number(
        summary?.errors_count ?? failure?.diagnostics?.length ?? -1
      )
    }
  } finally {
    for (const spy of spies) spy.mockRestore()

    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}
