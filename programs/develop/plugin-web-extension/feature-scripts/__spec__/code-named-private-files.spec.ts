import fsModule from 'node:fs'
import * as fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {
  build,
  canLink,
  linkPackages,
  linkWorkspace,
  MARKER,
  manifest,
  project
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

// Whole production builds, one per target: the background worker names that
// target in code, and the row says what the output folder holds.

// A row in one line: what landed besides the fixture's own files, then
// `MARKED` when a landed file carries a marker, what the build said, the
// private files the build opened, and its error count when not zero.
type Table = Record<string, string>

interface Tracer {
  name: string
  // What the worker holds to name the target.
  source: (target: string) => string
  // Files the fixture adds, which land in every build of it.
  files?: (target: string) => Record<string, string>
  always?: string[]
  // Left out for a call read against every target.
  targets?: string[]
}

const literal = (target: string) => JSON.stringify(target)

const viaGetURL = (file: string, contents: (target: string) => string) => ({
  source: () => `chrome.runtime.getURL(${literal(file)})\n`,
  files: (target: string) => ({[file]: contents(target)}),
  always: [file]
})

// One of each kind, for a call another call shares its reading with.
const FEW = [
  '.env',
  '.git/logo.png',
  'linked.txt',
  'out.js',
  'out.png',
  'data/ok.json',
  'node_modules/plain-pkg/data.json',
  'node_modules/stray-pkg/data.json',
  'node_modules/plain-pkg/.env'
]

const TRACERS: Record<string, Tracer> = {
  importScripts: {
    name: 'importScripts()',
    source: (target) => `importScripts(${literal(target)})\n`
  },
  fetch: {
    name: 'fetch()',
    source: (target) => `fetch(${literal(target)})\n`
  },
  getURL: {
    name: 'runtime.getURL()',
    source: (target) => `chrome.runtime.getURL(${literal(target)})\n`
  },
  executeScript: {
    name: 'scripting.executeScript({files})',
    source: (target) =>
      `chrome.scripting.executeScript({target: {tabId: 1}, files: [${literal(target)}]})\n`
  },
  insertCSS: {
    name: 'scripting.insertCSS({files})',
    targets: FEW,
    source: (target) =>
      `chrome.scripting.insertCSS({target: {tabId: 1}, files: [${literal(target)}]})\n`
  },
  tabsExecuteScript: {
    name: 'tabs.executeScript({file})',
    targets: FEW,
    source: (target) =>
      `chrome.tabs.executeScript(1, {file: ${literal(target)}})\n`
  },
  registerContentScripts: {
    name: 'scripting.registerContentScripts({js})',
    targets: FEW,
    source: (target) =>
      `chrome.scripting.registerContentScripts([{id: "a", matches: ["https://example.com/*"], js: [${literal(target)}]}])\n`
  },
  setIcon: {
    name: 'action.setIcon({path})',
    targets: FEW,
    source: (target) => `chrome.action.setIcon({path: ${literal(target)}})\n`
  },
  plainString: {
    name: 'a path kept as a plain string',
    source: (target) => `globalThis.kept = ${literal(target)}\n`
  },
  copiedPage: {
    name: 'a page the build copies as written',
    ...viaGetURL(
      'viewer.html',
      (target) =>
        `<!doctype html><html><head></head><body><img src=${literal(target)}></body></html>`
    )
  },
  copiedSheet: {
    name: 'a stylesheet the build copies as written',
    ...viaGetURL(
      'theme.css',
      (target) => `body { background: url(${literal(target)}) }\n`
    )
  },
  copiedScript: {
    name: 'a script the build copies as written',
    ...viaGetURL(
      'tool.js',
      (target) => `var tool = chrome.runtime.getURL(${literal(target)})\n`
    ),
    targets: FEW
  }
}

// The opening of each fake private file, which no message may quote.
const OPENINGS = ['PRIVATE_K', 'export PR', '# FAKE', 'FAKE-MARK', 'KEY=']

const FILES: Record<string, string> = {
  '.git/hooks/pre-push.sh': `# ${MARKER}-git-hook\n`,
  '.git/hooks/tool.js': `var hook = "${MARKER}-git-script"\n`,
  '.git/logo.png': `${MARKER}-git-image\n`,
  'a/.env': `PRIVATE_KEY=${MARKER}-nested-env\n`,
  '.env.example': 'EXAMPLE=\n',
  'public/hosted.txt': 'hosted',
  'lib/ok.js': 'var ok = 1\n',
  'lib/ok.css': 'body { color: red }\n',
  'lib/typed.ts': 'export const typed: number = 1\nconsole.log(typed)\n'
}

function fixture(tracer: Tracer, target: string) {
  const root = project({
    ...FILES,
    ...tracer.files?.(target),
    'sw.js': tracer.source(target),
    'manifest.json': manifest({background: {service_worker: 'sw.js'}})
  })
  const holder = path.dirname(root)

  linkWorkspace(root, {'logo.txt': `${MARKER}-workspace\n`})
  linkPackages(root)

  // Scripts outside the project: one the browser runs as written, one the
  // build would have to compile.
  fs.writeFileSync(
    path.join(holder, 'outside.js'),
    `var outside = "${MARKER}-outside-script"\n`
  )

  fs.writeFileSync(
    path.join(holder, 'outside-module.js'),
    `export const outside = "${MARKER}-outside-module"\nconsole.log(outside)\n`
  )

  fs.writeFileSync(
    path.join(holder, 'outside.png'),
    `${MARKER}-outside-image\n`
  )

  if (canLink) {
    fs.symlinkSync(path.join(holder, 'outside.js'), path.join(root, 'out.js'))
    fs.symlinkSync(path.join(holder, 'outside.png'), path.join(root, 'out.png'))
    fs.symlinkSync(
      path.join(holder, 'outside-module.js'),
      path.join(root, 'out-module.js')
    )
  }

  return root
}

const SAID: Array<[string, RegExp]> = [
  [
    'importScripts',
    /calls importScripts\('([^']+)'\), but the file isn't in the output\./g
  ],
  [
    'fetch',
    /loads '([^']+)' at runtime \(fetch\/XMLHttpRequest\/new URL\), but the file isn't in the output\./g
  ],
  [
    'getURL',
    /references '([^']+)' via chrome\.runtime\.getURL\(\), but the file isn't in the output\./g
  ],
  [
    'injected',
    /injects '([^']+)' via executeScript\/insertCSS, but the file isn't in the output\./g
  ],
  [
    'surface',
    /names '([^']+)' at runtime \(setPopup, setIcon, panels\.create, tabs\.create and friends\), but the file isn't in the output\./g
  ]
]

const PRIVATE_NAME =
  /(?:^|\/)(?:\.env(?:\.local)?|\.envrc|\.npmrc|\.git)(?:\/|$)/
const OUTSIDE =
  /^(?:outside|elsewhere\/|other-project\/|shared-assets\/|outside-folder\/)/

// The fake private files a build opened from JavaScript, by where they sit.
async function readsOf<T>(holder: string, run: () => Promise<T>) {
  const opened: string[] = []

  const note = (file: unknown) => {
    if (typeof file !== 'string' && !Buffer.isBuffer(file)) return

    try {
      const rel = path
        .relative(holder, fs.realpathSync(String(file)))
        .replace(/\\/g, '/')

      if (rel.startsWith('..')) return
      if (rel.startsWith('project/dist/')) return

      const inside = rel.startsWith('project/')
      if (inside ? PRIVATE_NAME.test(rel) : OUTSIDE.test(rel)) opened.push(rel)
    } catch {
      // A path that leads nowhere opens nothing.
    }
  }

  const spies = (
    [
      'readFileSync',
      'readFile',
      'openSync',
      'open',
      'createReadStream'
    ] as const
  ).map((name) =>
    vi.spyOn(fsModule, name).mockImplementation(((...args: unknown[]) => {
      note(args[0])

      return (original[name] as (...all: unknown[]) => unknown)(...args)
    }) as never)
  )

  syncBuiltinESMExports()

  try {
    return {result: await run(), opened}
  } finally {
    for (const spy of spies) spy.mockRestore()

    syncBuiltinESMExports()
  }
}

const original = {
  readFileSync: fsModule.readFileSync,
  readFile: fsModule.readFile,
  openSync: fsModule.openSync,
  open: fsModule.open,
  createReadStream: fsModule.createReadStream
}

const baselines = new Map<Tracer, string[]>()

async function buildCounted(tracer: Tracer, target: string) {
  const root = fixture(tracer, target)

  return readsOf(path.dirname(root), () => build(root))
}

// What every build of the fixture opens, whatever the worker names: the env
// files the build itself loads.
async function baselineOf(tracer: Tracer): Promise<string[]> {
  let baseline = baselines.get(tracer)

  if (!baseline) {
    baseline = (await buildCounted(tracer, 'lib/absent.txt')).opened
    baselines.set(tracer, baseline)
  }

  return baseline
}

async function rowFor(tracer: Tracer, target: string): Promise<string> {
  const baseline = [...(await baselineOf(tracer))]
  const {result, opened} = await buildCounted(tracer, target)
  const always = [
    'background/service_worker.js',
    'hosted.txt',
    ...(tracer.always ?? [])
  ]
  const said = new Set<string>()

  for (const [kind, pattern] of SAID) {
    for (const match of result.printed.matchAll(pattern)) {
      said.add(`${kind} ${match[1]}`)
    }
  }

  // No message carries what a file holds, its opening characters included.
  for (const text of [MARKER, ...OPENINGS]) {
    expect(result.printed, target).not.toContain(text)
  }

  const read = opened.filter((file) => {
    const at = baseline.indexOf(file)
    if (at === -1) return true

    baseline.splice(at, 1)

    return false
  })
  const landed = result.shipped.filter((file) => !always.includes(file))

  return [
    landed.join(' + ') || 'nothing',
    ...(result.marked.length ? ['MARKED'] : []),
    ...(said.size ? [`said ${[...said].sort().join(', ')}`] : []),
    ...(read.length ? [`read ${[...new Set(read)].sort().join(', ')}`] : []),
    ...(result.errors ? [`errors ${result.errors}`] : [])
  ].join(' | ')
}

async function tableFor(tracer: Tracer, targets: string[]): Promise<Table> {
  const table: Table = {}

  for (const target of targets) {
    table[target] = await rowFor(tracer, target)
  }

  return table
}

const TIMEOUT = 600_000

const TARGETS = [
  '.env',
  '/.env',
  './.env',
  '.env.local',
  '.npmrc',
  '.envrc',
  '.git/hooks/pre-push.sh',
  '.git/hooks/tool.js',
  '.git/logo.png',
  'a/.env',
  'a/../.envrc',
  '../outside.txt',
  'sub/../../outside.txt',
  '%2e%2e/outside.txt',
  'linked.txt',
  'linked-folder/inner.txt',
  'shared/logo.txt',
  'out.js',
  'out-module.js',
  'out.png',
  'alias.json',
  '.env.example',
  'data/ok.json',
  'lib/ok.js',
  'lib/ok.css',
  'lib/typed.ts',
  'hosted.txt',
  'nothing.txt',
  'node_modules/plain-pkg/data.json',
  'node_modules/plain-pkg/lib.js',
  'node_modules/store-pkg/data.json',
  'node_modules/workspace-pkg/data.json',
  'node_modules/stray-pkg/data.json',
  'node_modules/far-pkg/data.json',
  'node_modules/plain-pkg/.env',
  'node_modules/.npmrc'
]

const EXPECTED: Record<string, Table> = {
  importScripts: {
    '.env': 'background/.env | MARKED | read project/.env',
    '/.env': '.env | MARKED | read project/.env',
    './.env': 'background/.env | MARKED | read project/.env',
    '.env.local': 'background/.env.local | MARKED | read project/.env.local',
    '.npmrc': 'background/.npmrc | MARKED | read project/.npmrc',
    '.envrc': 'background/.envrc | MARKED | read project/.envrc',
    '.git/hooks/pre-push.sh':
      'background/.git/hooks/pre-push.sh | MARKED | read project/.git/hooks/pre-push.sh',
    '.git/hooks/tool.js':
      'background/.git/hooks/tool.js | MARKED | read project/.git/hooks/tool.js',
    '.git/logo.png':
      'background/.git/logo.png | MARKED | read project/.git/logo.png',
    'a/.env': 'background/a/.env | MARKED | read project/a/.env',
    'a/../.envrc': 'background/.envrc | MARKED | read project/.envrc',
    '../outside.txt': 'nothing | said importScripts ../outside.txt',
    'sub/../../outside.txt':
      'nothing | said importScripts sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said importScripts %2e%2e/outside.txt',
    'linked.txt': 'background/linked.txt | MARKED | read outside.txt',
    'linked-folder/inner.txt':
      'background/linked-folder/inner.txt + linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt':
      'background/shared/logo.txt + shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'background/out.js | MARKED | read outside.js',
    'out-module.js':
      'background/out-module.js | MARKED | read outside-module.js',
    'out.png': 'background/out.png | MARKED | read outside.png',
    'alias.json': 'background/alias.json',
    '.env.example': 'background/.env.example',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'lib/ok.js': 'background/lib/ok.js',
    'lib/ok.css': 'background/lib/ok.css',
    'lib/typed.ts': 'background/lib/typed.js',
    'hosted.txt': 'nothing | said importScripts hosted.txt',
    'nothing.txt': 'nothing | said importScripts nothing.txt',
    'node_modules/plain-pkg/data.json':
      'background/node_modules/plain-pkg/data.json',
    'node_modules/plain-pkg/lib.js': 'background/node_modules/plain-pkg/lib.js',
    'node_modules/store-pkg/data.json':
      'background/node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json':
      'background/node_modules/workspace-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'background/node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'background/node_modules/far-pkg/data.json | MARKED | read other-project/node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'background/node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env',
    'node_modules/.npmrc':
      'background/node_modules/.npmrc | MARKED | read project/node_modules/.npmrc'
  },
  fetch: {
    '.env': 'background/.env | MARKED | read project/.env',
    '/.env': '.env | MARKED | read project/.env',
    './.env': 'background/.env | MARKED | read project/.env',
    '.env.local': 'background/.env.local | MARKED | read project/.env.local',
    '.npmrc': 'background/.npmrc | MARKED | read project/.npmrc',
    '.envrc': 'background/.envrc | MARKED | read project/.envrc',
    '.git/hooks/pre-push.sh':
      'background/.git/hooks/pre-push.sh | MARKED | read project/.git/hooks/pre-push.sh',
    '.git/hooks/tool.js':
      'background/.git/hooks/tool.js | MARKED | read project/.git/hooks/tool.js',
    '.git/logo.png':
      'background/.git/logo.png | MARKED | read project/.git/logo.png',
    'a/.env': 'background/a/.env | MARKED | read project/a/.env',
    'a/../.envrc': 'background/.envrc | MARKED | read project/.envrc',
    '../outside.txt': 'nothing | said fetch ../outside.txt',
    'sub/../../outside.txt': 'nothing | said fetch sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said fetch %2e%2e/outside.txt',
    'linked.txt': 'background/linked.txt | MARKED | read outside.txt',
    'linked-folder/inner.txt':
      'background/linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt':
      'background/shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'background/out.js | MARKED | read outside.js',
    'out-module.js':
      'background/out-module.js | MARKED | read outside-module.js',
    'out.png': 'background/out.png | MARKED | read outside.png',
    'alias.json': 'background/alias.json',
    '.env.example': 'background/.env.example',
    'data/ok.json': 'background/data/ok.json',
    'lib/ok.js': 'background/lib/ok.js',
    'lib/ok.css': 'background/lib/ok.css',
    'lib/typed.ts': 'background/lib/typed.ts',
    'hosted.txt': 'nothing | said fetch hosted.txt',
    'nothing.txt': 'nothing | said fetch nothing.txt',
    'node_modules/plain-pkg/data.json':
      'background/node_modules/plain-pkg/data.json',
    'node_modules/plain-pkg/lib.js': 'background/node_modules/plain-pkg/lib.js',
    'node_modules/store-pkg/data.json':
      'background/node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json':
      'background/node_modules/workspace-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'background/node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'background/node_modules/far-pkg/data.json | MARKED | read other-project/node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'background/node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env',
    'node_modules/.npmrc':
      'background/node_modules/.npmrc | MARKED | read project/node_modules/.npmrc'
  },
  getURL: {
    '.env': '.env | MARKED | read project/.env',
    '/.env': '.env | MARKED | read project/.env',
    './.env': '.env | MARKED | read project/.env',
    '.env.local': '.env.local | MARKED | read project/.env.local',
    '.npmrc': '.npmrc | MARKED | read project/.npmrc',
    '.envrc': '.envrc | MARKED | read project/.envrc',
    '.git/hooks/pre-push.sh':
      '.git/hooks/pre-push.sh | MARKED | read project/.git/hooks/pre-push.sh',
    '.git/hooks/tool.js':
      '.git/hooks/tool.js | MARKED | read project/.git/hooks/tool.js',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'a/.env': 'a/.env | MARKED | read project/a/.env',
    'a/../.envrc': '.envrc | MARKED | read project/.envrc',
    '../outside.txt': 'nothing | said getURL ../outside.txt',
    'sub/../../outside.txt': 'nothing | said getURL sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said getURL %2e%2e/outside.txt',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'linked-folder/inner.txt':
      'linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt': 'shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out-module.js': 'out-module.js | MARKED | read outside-module.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'alias.json': 'alias.json',
    '.env.example': '.env.example',
    'data/ok.json': 'data/ok.json',
    'lib/ok.js': 'lib/ok.js',
    'lib/ok.css': 'lib/ok.css',
    'lib/typed.ts': 'lib/typed.js',
    'hosted.txt': 'nothing',
    'nothing.txt': 'nothing | said getURL nothing.txt',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/plain-pkg/lib.js': 'node_modules/plain-pkg/lib.js',
    'node_modules/store-pkg/data.json': 'node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json':
      'node_modules/workspace-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'node_modules/far-pkg/data.json | MARKED | read other-project/node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env',
    'node_modules/.npmrc':
      'node_modules/.npmrc | MARKED | read project/node_modules/.npmrc'
  },
  executeScript: {
    '.env': '.env | MARKED | read project/.env',
    '/.env': '.env | MARKED | read project/.env',
    './.env': '.env | MARKED | read project/.env',
    '.env.local': '.env.local | MARKED | read project/.env.local',
    '.npmrc': '.npmrc | MARKED | read project/.npmrc',
    '.envrc': '.envrc | MARKED | read project/.envrc',
    '.git/hooks/pre-push.sh':
      '.git/hooks/pre-push.sh | MARKED | read project/.git/hooks/pre-push.sh',
    '.git/hooks/tool.js':
      '.git/hooks/tool.js | MARKED | read project/.git/hooks/tool.js',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'a/.env': 'a/.env | MARKED | read project/a/.env',
    'a/../.envrc': '.envrc | MARKED | read project/.envrc',
    '../outside.txt': 'nothing | said injected ../outside.txt',
    'sub/../../outside.txt': 'nothing | said injected sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said injected %2e%2e/outside.txt',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'linked-folder/inner.txt':
      'background/linked-folder/inner.txt + linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt':
      'background/shared/logo.txt + shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out-module.js': 'out-module.js | MARKED | read outside-module.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'alias.json': 'alias.json',
    '.env.example': '.env.example',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'lib/ok.js': 'lib/ok.js',
    'lib/ok.css': 'lib/ok.css',
    'lib/typed.ts': 'lib/typed.js',
    'hosted.txt': 'nothing',
    'nothing.txt': 'nothing | said injected nothing.txt',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/plain-pkg/lib.js': 'node_modules/plain-pkg/lib.js',
    'node_modules/store-pkg/data.json': 'node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json':
      'node_modules/workspace-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'node_modules/far-pkg/data.json | MARKED | read other-project/node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env',
    'node_modules/.npmrc':
      'node_modules/.npmrc | MARKED | read project/node_modules/.npmrc'
  },
  insertCSS: {
    '.env': '.env | MARKED | read project/.env',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env'
  },
  tabsExecuteScript: {
    '.env': '.env | MARKED | read project/.env',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env'
  },
  registerContentScripts: {
    '.env': '.env | MARKED | read project/.env',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env'
  },
  setIcon: {
    '.env': 'nothing',
    '.git/logo.png':
      'background/.git/logo.png | MARKED | read project/.git/logo.png',
    'linked.txt': 'nothing',
    'out.js': 'nothing',
    'out.png': 'background/out.png | MARKED | read outside.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'nothing',
    'node_modules/stray-pkg/data.json': 'nothing',
    'node_modules/plain-pkg/.env': 'nothing'
  },
  plainString: {
    '.env': 'nothing',
    '/.env': 'nothing',
    './.env': 'nothing',
    '.env.local': 'nothing',
    '.npmrc': 'nothing',
    '.envrc': 'nothing',
    '.git/hooks/pre-push.sh': 'nothing',
    '.git/hooks/tool.js': 'nothing',
    '.git/logo.png': 'nothing',
    'a/.env': 'nothing',
    'a/../.envrc': 'nothing',
    '../outside.txt': 'nothing',
    'sub/../../outside.txt': 'nothing',
    '%2e%2e/outside.txt': 'nothing',
    'linked.txt': 'nothing',
    'linked-folder/inner.txt':
      'background/linked-folder/inner.txt + linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt':
      'background/shared/logo.txt + shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'nothing',
    'out-module.js': 'nothing',
    'out.png': 'nothing',
    'alias.json': 'nothing',
    '.env.example': 'nothing',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'lib/ok.js': 'nothing',
    'lib/ok.css': 'nothing',
    'lib/typed.ts': 'nothing',
    'hosted.txt': 'nothing',
    'nothing.txt': 'nothing',
    'node_modules/plain-pkg/data.json': 'nothing',
    'node_modules/plain-pkg/lib.js': 'nothing',
    'node_modules/store-pkg/data.json': 'nothing',
    'node_modules/workspace-pkg/data.json': 'nothing',
    'node_modules/stray-pkg/data.json': 'nothing',
    'node_modules/far-pkg/data.json': 'nothing',
    'node_modules/plain-pkg/.env': 'nothing',
    'node_modules/.npmrc': 'nothing'
  },
  copiedPage: {
    '.env': '.env | MARKED | read project/.env',
    '/.env': '.env | MARKED | read project/.env',
    './.env': '.env | MARKED | read project/.env',
    '.env.local': '.env.local | MARKED | read project/.env.local',
    '.npmrc': '.npmrc | MARKED | read project/.npmrc',
    '.envrc': '.envrc | MARKED | read project/.envrc',
    '.git/hooks/pre-push.sh':
      '.git/hooks/pre-push.sh | MARKED | read project/.git/hooks/pre-push.sh',
    '.git/hooks/tool.js':
      '.git/hooks/tool.js | MARKED | read project/.git/hooks/tool.js',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'a/.env': 'a/.env | MARKED | read project/a/.env',
    'a/../.envrc': '.envrc | MARKED | read project/.envrc',
    '../outside.txt': 'nothing',
    'sub/../../outside.txt': 'nothing',
    '%2e%2e/outside.txt': 'nothing',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'linked-folder/inner.txt':
      'linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt': 'shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out-module.js': 'out-module.js | MARKED | read outside-module.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'alias.json': 'alias.json',
    '.env.example': '.env.example',
    'data/ok.json': 'data/ok.json',
    'lib/ok.js': 'lib/ok.js',
    'lib/ok.css': 'lib/ok.css',
    'lib/typed.ts': 'lib/typed.js',
    'hosted.txt': 'nothing',
    'nothing.txt': 'nothing',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/plain-pkg/lib.js': 'node_modules/plain-pkg/lib.js',
    'node_modules/store-pkg/data.json': 'node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json':
      'node_modules/workspace-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'node_modules/far-pkg/data.json | MARKED | read other-project/node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env',
    'node_modules/.npmrc':
      'node_modules/.npmrc | MARKED | read project/node_modules/.npmrc'
  },
  copiedSheet: {
    '.env': '.env | MARKED | read project/.env',
    '/.env': '.env | MARKED | read project/.env',
    './.env': '.env | MARKED | read project/.env',
    '.env.local': '.env.local | MARKED | read project/.env.local',
    '.npmrc': '.npmrc | MARKED | read project/.npmrc',
    '.envrc': '.envrc | MARKED | read project/.envrc',
    '.git/hooks/pre-push.sh':
      '.git/hooks/pre-push.sh | MARKED | read project/.git/hooks/pre-push.sh',
    '.git/hooks/tool.js':
      '.git/hooks/tool.js | MARKED | read project/.git/hooks/tool.js',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'a/.env': 'a/.env | MARKED | read project/a/.env',
    'a/../.envrc': '.envrc | MARKED | read project/.envrc',
    '../outside.txt': 'nothing',
    'sub/../../outside.txt': 'nothing',
    '%2e%2e/outside.txt': 'nothing',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'linked-folder/inner.txt':
      'linked-folder/inner.txt | MARKED | read outside-folder/inner.txt',
    'shared/logo.txt': 'shared/logo.txt | MARKED | read shared-assets/logo.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out-module.js': 'out-module.js | MARKED | read outside-module.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'alias.json': 'alias.json',
    '.env.example': '.env.example',
    'data/ok.json': 'data/ok.json',
    'lib/ok.js': 'lib/ok.js',
    'lib/ok.css': 'lib/ok.css',
    'lib/typed.ts': 'lib/typed.js',
    'hosted.txt': 'nothing',
    'nothing.txt': 'nothing',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/plain-pkg/lib.js': 'node_modules/plain-pkg/lib.js',
    'node_modules/store-pkg/data.json': 'node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json':
      'node_modules/workspace-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'node_modules/far-pkg/data.json | MARKED | read other-project/node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env',
    'node_modules/.npmrc':
      'node_modules/.npmrc | MARKED | read project/node_modules/.npmrc'
  },
  copiedScript: {
    '.env': '.env | MARKED | read project/.env',
    '.git/logo.png': '.git/logo.png | MARKED | read project/.git/logo.png',
    'linked.txt': 'linked.txt | MARKED | read outside.txt',
    'out.js': 'out.js | MARKED | read outside.js',
    'out.png': 'out.png | MARKED | read outside.png',
    'data/ok.json': 'data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json':
      'node_modules/stray-pkg/data.json | MARKED | read elsewhere/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'node_modules/plain-pkg/.env | MARKED | read project/node_modules/plain-pkg/.env'
  }
}

describe.skipIf(!canLink).each(Object.keys(TRACERS))('%s', (key) => {
  it(
    'names each target',
    async () => {
      const actual = await tableFor(
        TRACERS[key],
        TRACERS[key].targets ?? TARGETS
      )

      expect(actual).toEqual(EXPECTED[key])
    },
    TIMEOUT
  )
})
