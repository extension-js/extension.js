import fsModule, * as fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  linkPackages,
  linkWorkspace,
  MARKER,
  manifest,
  notFoundPaths,
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

  linkWorkspace(root, {'logo.txt': 'workspace-shared\n'})
  linkPackages(root)

  // Scripts beside the project, which the workspace shares: one the browser
  // runs as written, one the build would have to compile.
  fs.writeFileSync(
    path.join(holder, 'outside.js'),
    'var outside = "workspace-outside-script"\n'
  )

  fs.writeFileSync(
    path.join(holder, 'outside-module.js'),
    'export const outside = "workspace-outside-module"\nconsole.log(outside)\n'
  )

  fs.writeFileSync(
    path.join(holder, 'outside.png'),
    'workspace-outside-image\n'
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
  ],
  // The words for a file that is there and that the build will not copy.
  ['withheld', /names '([^']+)', but the file isn't in the output\./g]
]

const PRIVATE_NAME =
  /(?:^|\/)(?:\.env(?:\.local)?|\.envrc|\.npmrc|\.git)(?:\/|$)/
// Beside the project sits the workspace, whose files are no private ones,
// apart from the `node_modules` of another package.
const OUTSIDE = /^other-project\//

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

  // No message and no output file carries what a private file holds.
  expectNothingPrivate(result)

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

// The links, the scripts and the stray package beside the project lead into
// the workspace, so they ship like project files.
const EXPECTED: Record<string, Table> = {
  importScripts: {
    '.env': 'nothing | said importScripts .env',
    '/.env': 'nothing | said importScripts /.env',
    './.env': 'nothing | said importScripts ./.env',
    '.env.local': 'nothing | said importScripts .env.local',
    '.npmrc': 'nothing | said importScripts .npmrc',
    '.envrc': 'nothing | said importScripts .envrc',
    '.git/hooks/pre-push.sh':
      'nothing | said importScripts .git/hooks/pre-push.sh',
    '.git/hooks/tool.js': 'nothing | said importScripts .git/hooks/tool.js',
    '.git/logo.png': 'nothing | said importScripts .git/logo.png',
    'a/.env': 'nothing | said importScripts a/.env',
    'a/../.envrc': 'nothing | said importScripts a/../.envrc',
    '../outside.txt': 'nothing | said importScripts ../outside.txt',
    'sub/../../outside.txt':
      'nothing | said importScripts sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said importScripts %2e%2e/outside.txt',
    'linked.txt': 'background/linked.txt',
    'linked-folder/inner.txt':
      'background/linked-folder/inner.txt + linked-folder/inner.txt',
    'shared/logo.txt': 'background/shared/logo.txt + shared/logo.txt',
    'out.js': 'background/out.js',
    'out-module.js': 'background/out-module.js',
    'out.png': 'background/out.png',
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
      'background/node_modules/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'nothing | said importScripts node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said importScripts node_modules/plain-pkg/.env',
    'node_modules/.npmrc': 'nothing | said importScripts node_modules/.npmrc'
  },
  fetch: {
    '.env': 'nothing | said fetch .env',
    '/.env': 'nothing | said fetch /.env',
    './.env': 'nothing | said fetch ./.env',
    '.env.local': 'nothing | said fetch .env.local',
    '.npmrc': 'nothing | said fetch .npmrc',
    '.envrc': 'nothing | said fetch .envrc',
    '.git/hooks/pre-push.sh': 'nothing | said fetch .git/hooks/pre-push.sh',
    '.git/hooks/tool.js': 'nothing | said fetch .git/hooks/tool.js',
    '.git/logo.png': 'nothing | said fetch .git/logo.png',
    'a/.env': 'nothing | said fetch a/.env',
    'a/../.envrc': 'nothing | said fetch a/../.envrc',
    '../outside.txt': 'nothing | said fetch ../outside.txt',
    'sub/../../outside.txt': 'nothing | said fetch sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said fetch %2e%2e/outside.txt',
    'linked.txt': 'background/linked.txt',
    'linked-folder/inner.txt': 'background/linked-folder/inner.txt',
    'shared/logo.txt': 'background/shared/logo.txt',
    'out.js': 'background/out.js',
    'out-module.js': 'background/out-module.js',
    'out.png': 'background/out.png',
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
      'background/node_modules/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'nothing | said fetch node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said fetch node_modules/plain-pkg/.env',
    'node_modules/.npmrc': 'nothing | said fetch node_modules/.npmrc'
  },
  getURL: {
    '.env': 'nothing | said getURL .env',
    '/.env': 'nothing | said getURL /.env',
    './.env': 'nothing | said getURL ./.env',
    '.env.local': 'nothing | said getURL .env.local',
    '.npmrc': 'nothing | said getURL .npmrc',
    '.envrc': 'nothing | said getURL .envrc',
    '.git/hooks/pre-push.sh': 'nothing | said getURL .git/hooks/pre-push.sh',
    '.git/hooks/tool.js': 'nothing | said getURL .git/hooks/tool.js',
    '.git/logo.png': 'nothing | said getURL .git/logo.png',
    'a/.env': 'nothing | said getURL a/.env',
    'a/../.envrc': 'nothing | said getURL a/../.envrc',
    '../outside.txt': 'nothing | said getURL ../outside.txt',
    'sub/../../outside.txt': 'nothing | said getURL sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said getURL %2e%2e/outside.txt',
    'linked.txt': 'linked.txt',
    'linked-folder/inner.txt': 'linked-folder/inner.txt',
    'shared/logo.txt': 'shared/logo.txt',
    'out.js': 'out.js',
    'out-module.js': 'out-module.js',
    'out.png': 'out.png',
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
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'nothing | said getURL node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said getURL node_modules/plain-pkg/.env',
    'node_modules/.npmrc': 'nothing | said getURL node_modules/.npmrc'
  },
  executeScript: {
    '.env': 'nothing | said injected .env',
    '/.env': 'nothing | said injected /.env',
    './.env': 'nothing | said injected ./.env',
    '.env.local': 'nothing | said injected .env.local',
    '.npmrc': 'nothing | said injected .npmrc',
    '.envrc': 'nothing | said injected .envrc',
    '.git/hooks/pre-push.sh': 'nothing | said injected .git/hooks/pre-push.sh',
    '.git/hooks/tool.js': 'nothing | said injected .git/hooks/tool.js',
    '.git/logo.png': 'nothing | said injected .git/logo.png',
    'a/.env': 'nothing | said injected a/.env',
    'a/../.envrc': 'nothing | said injected a/../.envrc',
    '../outside.txt': 'nothing | said injected ../outside.txt',
    'sub/../../outside.txt': 'nothing | said injected sub/../../outside.txt',
    '%2e%2e/outside.txt': 'nothing | said injected %2e%2e/outside.txt',
    'linked.txt': 'linked.txt',
    'linked-folder/inner.txt':
      'background/linked-folder/inner.txt + linked-folder/inner.txt',
    'shared/logo.txt': 'background/shared/logo.txt + shared/logo.txt',
    'out.js': 'out.js',
    'out-module.js': 'out-module.js',
    'out.png': 'out.png',
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
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'nothing | said injected node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said injected node_modules/plain-pkg/.env',
    'node_modules/.npmrc': 'nothing | said injected node_modules/.npmrc'
  },
  insertCSS: {
    '.env': 'nothing | said injected .env',
    '.git/logo.png': 'nothing | said injected .git/logo.png',
    'linked.txt': 'linked.txt',
    'out.js': 'out.js',
    'out.png': 'out.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said injected node_modules/plain-pkg/.env'
  },
  tabsExecuteScript: {
    '.env': 'nothing | said injected .env',
    '.git/logo.png': 'nothing | said injected .git/logo.png',
    'linked.txt': 'linked.txt',
    'out.js': 'out.js',
    'out.png': 'out.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said injected node_modules/plain-pkg/.env'
  },
  registerContentScripts: {
    '.env': 'nothing | said injected .env',
    '.git/logo.png': 'nothing | said injected .git/logo.png',
    'linked.txt': 'linked.txt',
    'out.js': 'out.js',
    'out.png': 'out.png',
    'data/ok.json': 'background/data/ok.json + data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said injected node_modules/plain-pkg/.env'
  },
  setIcon: {
    '.env': 'nothing',
    '.git/logo.png': 'nothing | said surface .git/logo.png',
    'linked.txt': 'nothing',
    'out.js': 'nothing',
    'out.png': 'background/out.png',
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
      'background/linked-folder/inner.txt + linked-folder/inner.txt',
    'shared/logo.txt': 'background/shared/logo.txt + shared/logo.txt',
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
    '.env': 'nothing | said withheld .env',
    '/.env': 'nothing | said withheld /.env',
    './.env': 'nothing | said withheld ./.env',
    '.env.local': 'nothing | said withheld .env.local',
    '.npmrc': 'nothing | said withheld .npmrc',
    '.envrc': 'nothing | said withheld .envrc',
    '.git/hooks/pre-push.sh': 'nothing | said withheld .git/hooks/pre-push.sh',
    '.git/hooks/tool.js': 'nothing | said withheld .git/hooks/tool.js',
    '.git/logo.png': 'nothing | said withheld .git/logo.png',
    'a/.env': 'nothing | said withheld a/.env',
    'a/../.envrc': 'nothing | said withheld a/../.envrc',
    '../outside.txt': 'nothing',
    'sub/../../outside.txt': 'nothing',
    '%2e%2e/outside.txt': 'nothing',
    'linked.txt': 'linked.txt',
    'linked-folder/inner.txt': 'linked-folder/inner.txt',
    'shared/logo.txt': 'shared/logo.txt',
    'out.js': 'out.js',
    'out-module.js': 'out-module.js',
    'out.png': 'out.png',
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
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'nothing | said withheld node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said withheld node_modules/plain-pkg/.env',
    'node_modules/.npmrc': 'nothing | said withheld node_modules/.npmrc'
  },
  copiedSheet: {
    '.env': 'nothing | said withheld .env',
    '/.env': 'nothing | said withheld /.env',
    './.env': 'nothing | said withheld ./.env',
    '.env.local': 'nothing | said withheld .env.local',
    '.npmrc': 'nothing | said withheld .npmrc',
    '.envrc': 'nothing | said withheld .envrc',
    '.git/hooks/pre-push.sh': 'nothing | said withheld .git/hooks/pre-push.sh',
    '.git/hooks/tool.js': 'nothing | said withheld .git/hooks/tool.js',
    '.git/logo.png': 'nothing | said withheld .git/logo.png',
    'a/.env': 'nothing | said withheld a/.env',
    'a/../.envrc': 'nothing | said withheld a/../.envrc',
    '../outside.txt': 'nothing',
    'sub/../../outside.txt': 'nothing',
    '%2e%2e/outside.txt': 'nothing',
    'linked.txt': 'linked.txt',
    'linked-folder/inner.txt': 'linked-folder/inner.txt',
    'shared/logo.txt': 'shared/logo.txt',
    'out.js': 'out.js',
    'out-module.js': 'out-module.js',
    'out.png': 'out.png',
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
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/far-pkg/data.json':
      'nothing | said withheld node_modules/far-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said withheld node_modules/plain-pkg/.env',
    'node_modules/.npmrc': 'nothing | said withheld node_modules/.npmrc'
  },
  copiedScript: {
    '.env': 'nothing | said getURL .env',
    '.git/logo.png': 'nothing | said getURL .git/logo.png',
    'linked.txt': 'linked.txt',
    'out.js': 'out.js',
    'out.png': 'out.png',
    'data/ok.json': 'data/ok.json',
    'node_modules/plain-pkg/data.json': 'node_modules/plain-pkg/data.json',
    'node_modules/stray-pkg/data.json': 'node_modules/stray-pkg/data.json',
    'node_modules/plain-pkg/.env':
      'nothing | said getURL node_modules/plain-pkg/.env'
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

describe('a file the code names and the build withholds', () => {
  const times = (text: string, part: string) => text.split(part).length - 1

  it(
    'is said once for an output path, in the words a missing file gets',
    async () => {
      const root = fixture(
        {
          name: 'three calls for one file',
          source: () =>
            'fetch("/.env")\nfetch("../.env")\nfetch("/.env?fresh")\n'
        },
        '/.env'
      )
      const result = await build(root)

      // The text is read twice over: the printed lines, then the summary.
      for (const sentence of [
        "background/service_worker.js loads '/.env' at runtime (fetch/XMLHttpRequest/new URL), but the file isn't in the output.",
        'NOT FOUND .env',
        'The request fails at runtime.',
        'Move the file so it resolves to .env, or serve it from public/ so it ships with the extension.'
      ]) {
        expect(times(result.printed, sentence), sentence).toBe(2)
      }

      expect(times(result.printed, "isn't in the output.")).toBe(2)
      expect(notFoundPaths(result.printed)).toEqual(['.env'])
      expect(result.shipped).toEqual([
        'background/service_worker.js',
        'hosted.txt'
      ])

      expect(result.marked).toEqual([])
      expect(result.errors).toBe(0)

      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it.skipIf(!canLink)(
    'is said in words of its own where a missing file gets none',
    async () => {
      const target = 'far-folder/data.json'
      const root = fixture(TRACERS.plainString, target)

      // A folder link through the `node_modules` of another package.
      fs.symlinkSync(
        path.join(
          path.dirname(root),
          'other-project',
          'node_modules',
          'far-pkg'
        ),
        path.join(root, 'far-folder')
      )

      const result = await build(root)

      // One finding for each place the worker could mean: the root, then
      // beside the worker.
      for (const sentence of [
        `NOT FOUND ${target}`,
        `NOT FOUND background/${target}`
      ]) {
        expect(times(result.printed, sentence), sentence).toBe(2)
      }

      for (const sentence of [
        `background/service_worker.js names '${target}', but the file isn't in the output.`,
        'A read of it fails at runtime.',
        'The build never copies env files, tooling files or files outside the project. Keep what the extension reads in a project file under another name, or in public/.'
      ]) {
        expect(times(result.printed, sentence), sentence).toBe(4)
      }

      expect(notFoundPaths(result.printed)).toEqual([
        `background/${target}`,
        target
      ])

      expect(result.marked).toEqual([])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )

  it(
    'is withheld from a Firefox build the same way',
    async () => {
      const root = project({
        ...FILES,
        'background.js': 'fetch("/.env")\nbrowser.runtime.getURL(".npmrc")\n',
        'manifest.json': manifest({background: {scripts: ['background.js']}})
      })
      const result = await build(root, 'firefox')

      expect(result.shipped).toEqual(['background/scripts.js', 'hosted.txt'])
      expect(notFoundPaths(result.printed)).toEqual(['.env', '.npmrc'])
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})
