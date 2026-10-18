// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))
const EXTENSION_DIR = path.join(ROOT_DIR, 'programs', 'extension')
const BROWSERS_BUNDLE = path.join(EXTENSION_DIR, 'dist', 'browsers.cjs')
const requireFromExtension = createRequire(
  path.join(EXTENSION_DIR, 'package.json')
)

function fail(message) {
  console.error(`\n[edge-system-locate] FAILED: ${message}`)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', shell: false})

  return result.status === 0 ? String(result.stdout || '').trim() : ''
}

function systemEdge() {
  const fromPath = run('where', ['msedge'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (fromPath) return {path: fromPath, source: 'where msedge'}

  for (const hive of ['HKLM', 'HKCU']) {
    const key = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe`
    const match = /REG_SZ\s+(.+)$/m.exec(run('reg', ['query', key, '/ve']))

    if (match) return {path: match[1].trim(), source: `${key} (default)`}
  }

  return null
}

function canonical(file) {
  try {
    return realpathSync.native(file).toLowerCase()
  } catch {
    return path.resolve(file).toLowerCase()
  }
}

if (process.platform !== 'win32') {
  fail(
    'this proof reads the Windows well-known env names and runs on win32 only'
  )
}

const expected = systemEdge()

if (!expected) {
  fail(
    'no system Edge on this runner: `where msedge` and the App Paths registry keys answered nothing'
  )
}

console.log(`[edge-system-locate] system Edge via ${expected.source}:`)
console.log(`[edge-system-locate]   ${expected.path}`)

const emptyCache = mkdtempSync(path.join(tmpdir(), 'ext-empty-browser-cache-'))

delete process.env.EDGE_BINARY
delete process.env.PLAYWRIGHT_BROWSERS_PATH
process.env.EXT_BROWSERS_CACHE_DIR = emptyCache

const {sharedManagedCacheEnv} = requireFromExtension(BROWSERS_BUNDLE)
const edgeLocation = requireFromExtension('edge-location')
const locateEdge = edgeLocation.default || edgeLocation

const env = sharedManagedCacheEnv('edge')
const osKeys = Object.keys(process.env).filter((key) =>
  /^programfiles(\(x86\))?$/i.test(key)
)

console.log(
  `[edge-system-locate] OS spells the install roots as: ${osKeys.join(', ')}`
)

console.log(
  `[edge-system-locate] managed cache (empty): ${env.PLAYWRIGHT_BROWSERS_PATH}`
)

const found = locateEdge({env})

rmSync(emptyCache, {recursive: true, force: true})

if (!found) {
  fail(
    `the launcher env found no Edge; the system install at ${expected.path} was never probed`
  )
}

if (canonical(found) !== canonical(expected.path)) {
  fail(`the locator answered ${found} but the system Edge is ${expected.path}`)
}

console.log(`[edge-system-locate] OK, the locator found ${found}`)
