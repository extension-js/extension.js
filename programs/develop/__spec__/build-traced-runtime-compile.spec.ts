import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import * as acorn from 'acorn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// Runtime-loaded files the module graph cannot see (getURL targets,
// importScripts deps, executeScript payloads) used to be copied through
// verbatim. A TypeScript or ES-module source copied that way ships raw
// syntax and bare specifiers the browser cannot run. They now go through
// the bundler, keyed to the dist path the runtime asks for, while files
// the browser can run as written (classic .js, json, css) still copy.
const ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-traced-compile-')
)

function write(rel: string, content: string) {
  const abs = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, content)
}

function writeFixture() {
  write(
    'package.json',
    JSON.stringify(
      {
        private: true,
        name: 'extjs-build-traced-compile-spec',
        version: '0.0.0'
      },
      null,
      2
    )
  )
  write(
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, traced runtime files compile',
        version: '1.0.0',
        background: {service_worker: 'sw.js'},
        permissions: ['scripting'],
        content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}],
        web_accessible_resources: [
          {resources: ['lib/*', 'scripts/*'], matches: ['<all_urls>']}
        ]
      },
      null,
      2
    )
  )

  // Classic worker: an importScripts dep authored in TypeScript (the literal
  // names the emitted .js), a scripts/ file reached by getURL under both its
  // source and emitted spelling, and a classic TS injection payload.
  write(
    'sw.js',
    [
      'importScripts("lib/worker-util.js");',
      'console.log(typeof WORKER_UTIL, workerUtil(1));',
      'chrome.runtime.onInstalled.addListener(() => {',
      '  console.log(chrome.runtime.getURL("scripts/helper.ts"));',
      '  console.log(chrome.runtime.getURL("scripts/helper.js"));',
      '});',
      'chrome.action.onClicked.addListener((tab) => {',
      '  chrome.scripting.executeScript({',
      '    target: {tabId: tab.id},',
      '    files: ["inject/classic.js"]',
      '  });',
      '});',
      ''
    ].join('\n')
  )
  write(
    'lib/worker-util.ts',
    [
      'var WORKER_UTIL: string = "loaded";',
      'function workerUtil(n: number): number {',
      '  return n + 1;',
      '}',
      ''
    ].join('\n')
  )
  write(
    'inject/classic.ts',
    [
      'function classicHello(name: string): string {',
      '  return "hi " + name;',
      '}',
      'if (typeof document !== "undefined") document.title = classicHello("page");',
      ''
    ].join('\n')
  )
  write(
    'scripts/helper.ts',
    [
      'const label: string = "helper";',
      'console.log(label);',
      'export {};',
      ''
    ].join('\n')
  )

  // Content script: a getURL dynamic import of an ES module that pulls a
  // bare package and an extensionless relative TypeScript import.
  write(
    'content.js',
    [
      'import(chrome.runtime.getURL("lib/helper.js")).then((mod) => {',
      '  console.log(mod.MESSAGE);',
      '});',
      ''
    ].join('\n')
  )
  write(
    'lib/helper.js',
    [
      'import {shout} from "tiny-pkg";',
      'import {WORD} from "./word";',
      'export const MESSAGE = shout(WORD);',
      ''
    ].join('\n')
  )
  write('lib/word.ts', 'export const WORD: string = "traced";\n')
  write(
    'node_modules/tiny-pkg/package.json',
    JSON.stringify({name: 'tiny-pkg', version: '1.0.0', main: 'index.js'})
  )
  write(
    'node_modules/tiny-pkg/index.js',
    'exports.shout = function shout(s) { return String(s).toUpperCase(); };\n'
  )
}

async function buildFixture(mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE
  try {
    return await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

const distDir = () => path.join(ROOT, 'dist', 'chrome')
const read = (rel: string) => fs.readFileSync(path.join(distDir(), rel), 'utf8')
const exists = (rel: string) => fs.existsSync(path.join(distDir(), rel))
const listDist = () =>
  fs
    .readdirSync(distDir(), {recursive: true})
    .map(String)
    .filter((rel) => fs.statSync(path.join(distDir(), rel)).isFile())
    .sort()

// Runs the text as a classic script in a fresh realm and returns the globals
// it declared, which is exactly what importScripts and executeScript see.
function runAsClassicScript(code: string) {
  const sandbox: Record<string, unknown> = {console: {log() {}}}
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return sandbox
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('build: traced runtime-loaded sources are compiled, not copied (real rspack)', () => {
  it('compiles a getURL ES module with its bare and TypeScript imports resolved', async () => {
    const summary = await buildFixture('production')
    if (process.env.EXTJS_DUMP_TRACED) {
      console.log(`DIST FILES\n${listDist().join('\n')}`)
      for (const rel of [
        'lib/helper.js',
        'scripts/helper.ts',
        'scripts/helper.js',
        'inject/classic.js',
        'background/lib/worker-util.js'
      ]) {
        console.log(
          `\n--- ${rel} ---\n${exists(rel) ? read(rel).slice(0, 600) : '(absent)'}`
        )
      }
      console.log('WARNINGS', JSON.stringify(summary.warnings, null, 2))
    }
    expect(summary.errors_count).toBe(0)

    const helper = read('lib/helper.js')
    // No bare specifier and no relative import survive: the browser would
    // fail to resolve either from chrome-extension://.
    expect(helper).not.toMatch(/from\s*["']tiny-pkg["']/)
    expect(helper).not.toMatch(/from\s*["']\.\/word["']/)
    // The package and the TypeScript module both travel inside the file.
    expect(helper).toContain('toUpperCase')
    expect(helper).toContain('"traced"')
    // It is loaded through import(), so the output stays an ES module that
    // parses as one and still exports MESSAGE.
    const ast = acorn.parse(helper, {
      ecmaVersion: 'latest',
      sourceType: 'module'
    }) as unknown as {body: Array<{type: string}>}
    const exported = ast.body.filter((node) => /^Export/.test(node.type))
    expect(exported.length).toBeGreaterThan(0)
    expect(helper).toMatch(/\bMESSAGE\b/)
    // The TypeScript import is bundled in, not shipped as a raw sibling.
    expect(exists('lib/word.ts')).toBe(false)
    expect(exists('lib/word.js')).toBe(false)
  }, 120_000)

  it('compiles an importScripts dep authored in TypeScript at the worker-relative path and keeps its globals', () => {
    const rel = 'background/lib/worker-util.js'
    expect(exists(rel), `missing ${rel}`).toBe(true)
    const code = read(rel)
    expect(code).not.toContain(': string')
    expect(code).not.toContain(': number')
    // Classic scripts share the worker's global scope, so the compiled file
    // must still declare its top-level names as globals.
    const globals = runAsClassicScript(code)
    expect(globals.WORKER_UTIL).toBe('loaded')
    expect(typeof globals.workerUtil).toBe('function')
    expect(exists('background/lib/worker-util.ts')).toBe(false)
    expect(exists('lib/worker-util.ts')).toBe(false)
  })

  it('compiles an executeScript payload authored in TypeScript at the injected path', () => {
    expect(exists('inject/classic.js')).toBe(true)
    const code = read('inject/classic.js')
    expect(code).not.toContain(': string')
    const globals = runAsClassicScript(code)
    expect(typeof globals.classicHello).toBe('function')
    expect(exists('inject/classic.ts')).toBe(false)
  })

  it('emits a scripts/ file that is both an entry and a getURL target exactly once, compiled', () => {
    const files = listDist().filter((rel) => rel.startsWith('scripts/helper'))
    expect(files).toEqual(['scripts/helper.js'])
    const code = read('scripts/helper.js')
    expect(code).not.toContain(': string')
    expect(code).toContain('helper')
  })

  it('leaves no raw TypeScript anywhere in dist', () => {
    const raw = listDist().filter((rel) => /\.(?:ts|tsx|mts|cts)$/.test(rel))
    expect(raw).toEqual([])
  })

  it('does the same in a development build', async () => {
    const summary = await buildFixture('development')
    expect(summary.errors_count).toBe(0)
    const helper = read('lib/helper.js')
    expect(helper).not.toMatch(/from\s*["']tiny-pkg["']/)
    expect(helper).toContain('toUpperCase')
    expect(helper).toContain('"traced"')
    const globals = runAsClassicScript(read('background/lib/worker-util.js'))
    expect(globals.WORKER_UTIL).toBe('loaded')
    expect(listDist().filter((rel) => /\.ts$/.test(rel))).toEqual([])
  }, 120_000)
})
