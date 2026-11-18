import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, expect, vi} from 'vitest'
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
      private: true,
      name: 'root-refs',
      version: '1.0.0',
      description: `${MARKER}-package`
    }),
    'extension.config.js': 'export default {}\n',
    'node_modules/pkg/data.json': '{"value":"installed"}',
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

// Installed packages, made by hand: a plain folder, two linked the way pnpm
// links them, two links that leave every `node_modules` above the project.
export function linkPackages(
  root: string,
  // What each `data.json` holds, for a field that reads only its own shape.
  data: (from: string) => string = (from) => JSON.stringify({from})
) {
  const holder = path.dirname(root)
  const modules = path.join(root, 'node_modules')

  const write = (file: string, contents: string) => {
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  const store = (base: string, name: string) =>
    path.join(base, 'node_modules/.pnpm', `${name}@1.0.0`, 'node_modules', name)

  write(path.join(modules, 'plain-pkg/data.json'), data('plain-pkg'))
  write(path.join(modules, 'plain-pkg/lib.js'), 'var plainPkg = 1\n')
  write(path.join(modules, 'plain-pkg/.env'), `KEY=${MARKER}-pkg-env\n`)
  write(path.join(modules, '.npmrc'), `# ${MARKER}-modules-npmrc\n`)
  write(path.join(store(root, 'store-pkg'), 'data.json'), data('store-pkg'))

  write(
    path.join(store(holder, 'workspace-pkg'), 'data.json'),
    data('workspace-pkg')
  )

  write(
    path.join(holder, 'elsewhere/stray-pkg/data.json'),
    data(`${MARKER}-stray`)
  )

  write(
    path.join(holder, 'other-project/node_modules/far-pkg/data.json'),
    data(`${MARKER}-far`)
  )

  if (!canLink) return

  const link = (target: string, name: string) =>
    fs.symlinkSync(target, path.join(modules, name))

  link(store(root, 'store-pkg'), 'store-pkg')
  link(store(holder, 'workspace-pkg'), 'workspace-pkg')
  link(path.join(holder, 'elsewhere/stray-pkg'), 'stray-pkg')
  link(path.join(holder, 'other-project/node_modules/far-pkg'), 'far-pkg')
}

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

// A bundled asset carries a content hash in its name.
const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

// A parse error once quoted the first characters of the file it read.
const OPENING_LENGTH = 10

// The marker and the opening characters of every fake private file under
// the holder. An opening a plain fixture file shares says nothing, so it is
// left out.
function privateTextOf(holder: string): string[] {
  const marked = new Set<string>()
  const plain = new Set<string>()

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (full !== path.join(holder, 'project', 'dist')) walk(full)

        continue
      }

      if (!entry.isFile()) continue

      const contents = fs.readFileSync(full, 'utf-8')
      const opening = contents.slice(0, OPENING_LENGTH)

      if (contents.includes(MARKER)) marked.add(opening)
      else plain.add(opening)
    }
  }

  walk(holder)

  return [MARKER, ...[...marked].filter((opening) => !plain.has(opening))]
}

// The paths a build names as not found, in the order of the alphabet. The
// summary repeats each message as JSON, where a line ends in a written \n.
export function notFoundPaths(printed: string): string[] {
  const found = new Set<string>()

  for (const match of printed.matchAll(/NOT FOUND (\S+?)(?=\\n|\s|$)/g)) {
    found.add(match[1])
  }

  return [...found].sort()
}

export interface Built {
  // Every file in the output folder but the page and the manifest.
  shipped: string[]
  // The files that carry a marker, which no build should hold.
  marked: string[]
  // Where the marker or the opening of a fake private file shows: a line
  // per output file that holds one, and one for the text the build printed.
  exposed: {output: string[]; printed: string[]}
  // The refs a warning or an error names as missing.
  missing: string[]
  printed: string
  errors: number
}

const isError = (diagnostic: unknown) =>
  (diagnostic as {severity?: string}).severity === 'error'

// No fake private file shows, by its marker or by its opening characters,
// in the output folder or in anything the build printed. `printed` is for a
// build whose output another step is known to fill.
export function expectNothingPrivate(
  result: Built,
  where: 'everywhere' | 'printed' = 'everywhere'
) {
  expect(result.exposed.printed).toEqual([])

  if (where === 'everywhere') expect(result.exposed.output).toEqual([])
}

export async function build(root: string, browser = 'chrome'): Promise<Built> {
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
        browser,
        silent: false,
        install: false,
        mode: 'production',
        exitOnError: false
      } as never)
    } catch (error) {
      failure = error as {diagnostics?: unknown[]}
      if (!Array.isArray(failure.diagnostics)) throw error
    }

    const out = listOutput(path.join(root, 'dist', browser))
    const printed = [lines.join('\n'), JSON.stringify(summary ?? failure)]
      .join('\n')
      .replace(ANSI, '')
    const missing = new Set<string>()

    for (const match of printed.matchAll(
      /Update the (\/\S+) reference to point|A url\((\/[^)]+)\) reference points to a file that exists nowhere/g
    )) {
      missing.add(match[1] || match[2])
    }

    const privateText = privateTextOf(path.dirname(root))

    return {
      exposed: {
        output: Object.keys(out)
          .sort()
          .flatMap((name) =>
            privateText
              .filter((text) => out[name].includes(text))
              .map((text) => `${withoutHash(name)}: ${text}`)
          ),
        printed: privateText.filter((text) => printed.includes(text))
      },
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
