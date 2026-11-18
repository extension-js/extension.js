import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, vi} from 'vitest'
import {listOutput} from './compile-harness'

// A fixture project of fake private files, one folder below a holder that
// stands for everything outside it, and a whole production build of it.

const holders: string[] = []

afterAll(() => {
  for (const holder of holders) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
})

// Obvious fakes: no file here holds a real value.
export const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'
export const canLink = process.platform !== 'win32'

export const PAGE = '<!doctype html><html><head></head><body></body></html>'

export function manifest(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    manifest_version: 3,
    name: 'root-refs',
    version: '1.0.0',
    action: {default_popup: 'popup.html'},
    ...extra
  })
}

// The project sits one folder down, so a climbing path has a file to reach.
export function project(files: Record<string, string>) {
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-root-private-'))
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
      name: 'root-refs',
      version: '1.0.0',
      private: true,
      description: `${MARKER}-package`
    }),
    'extension.config.js': 'export default {}\n',
    'node_modules/pkg/data.json': `{"value":"${MARKER}-node-modules"}`,
    'a/keep.txt': 'keep',
    'data/ok.json': '{"ok":true}',
    'manifest.json': manifest(),
    'popup.html': PAGE,
    ...files
  }

  for (const [relative, contents] of Object.entries(all)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  fs.writeFileSync(path.join(holder, 'outside.txt'), `${MARKER}-outside\n`)
  fs.mkdirSync(path.join(holder, 'outside-folder'))
  fs.writeFileSync(
    path.join(holder, 'outside-folder', 'inner.txt'),
    `${MARKER}-outside-folder\n`
  )

  if (canLink) {
    fs.symlinkSync(
      path.join(holder, 'outside.txt'),
      path.join(root, 'linked.txt')
    )

    fs.symlinkSync(
      path.join(holder, 'outside-folder'),
      path.join(root, 'linked-folder')
    )
  }

  return root
}

// A package of a workspace: `shared` links a folder its siblings own, and
// `alias.json` links a file of the project itself.
export function linkWorkspace(root: string, shared: Record<string, string>) {
  const holder = path.dirname(root)
  const folder = path.join(holder, 'shared-assets')

  fs.writeFileSync(path.join(holder, 'pnpm-workspace.yaml'), 'packages: []\n')
  fs.mkdirSync(folder)

  for (const [name, contents] of Object.entries(shared)) {
    fs.writeFileSync(path.join(folder, name), contents)
  }

  if (canLink) {
    fs.symlinkSync(folder, path.join(root, 'shared'))
    fs.symlinkSync(
      path.join(root, 'data', 'ok.json'),
      path.join(root, 'alias.json')
    )
  }
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
  // The refs a warning or an error names as missing.
  missing: string[]
  printed: string
  errors: number
}

const isError = (diagnostic: unknown) =>
  (diagnostic as {severity?: string}).severity === 'error'

export async function build(root: string): Promise<Built> {
  const {extensionBuild} = await import('../../../command-build')
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

    // A build that fails writes no output folder and rejects with its errors.
    try {
      summary = await extensionBuild(root, {
        browser: 'chrome',
        silent: false,
        install: false,
        mode: 'production',
        exitOnError: false
      } as never)
    } catch (error) {
      failure = error as {diagnostics?: unknown[]}
      if (!Array.isArray(failure.diagnostics)) throw error
    }

    const out = listOutput(path.join(root, 'dist', 'chrome'))
    const printed = [lines.join('\n'), JSON.stringify(summary ?? failure)]
      .join('\n')
      .replace(ANSI, '')
    const missing = new Set<string>()

    for (const match of printed.matchAll(
      /Update the (\/\S+) reference to point|A url\((\/[^)]+)\) reference points to a file that exists nowhere/g
    )) {
      missing.add(match[1] || match[2])
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
      printed,
      errors: failure
        ? (failure.diagnostics || []).filter(isError).length
        : Number(summary?.errors_count ?? -1)
    }
  } finally {
    for (const spy of spies) spy.mockRestore()

    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}
