import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import * as acorn from 'acorn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// A root-absolute ref in HTML or CSS (Chrome resolves a leading '/' from the
// extension root) used to be read from disk and emitted verbatim, with its
// static imports chased the same way. A TypeScript or ES-module source shipped
// raw. JS-like files now go through the same child compilation as the
// runtime-loaded file tracer, data files and classic .js still copy.
const ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-root-abs-compile-')
)

const CLASSIC_SRC =
  'var VENDOR_READY = true\nfunction vendorHello(name) { return "hi " + name }\n'
const JSON_SRC = '{\n  "answer": 42,\n  "note": "verbatim"\n}\n'
const CSS_SRC = 'body { background: url(/data/x.json); }\n'

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
        name: 'extjs-build-root-abs-compile-spec',
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
        name: 'Build Spec, root-absolute refs compile',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  // A scripts/ source under its .ts spelling, a lib/ module under its emitted
  // spelling, a classic vendor script and a stylesheet naming a data file.
  write(
    'popup.html',
    [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="/styles/page.css">',
      '</head><body><div id="out"></div>',
      '<script src="/scripts/util.ts"></script>',
      '<script src="/lib/widget.js" type="module"></script>',
      '<script src="/vendor/classic.js"></script>',
      '</body></html>',
      ''
    ].join('\n')
  )

  write(
    'scripts/util.ts',
    [
      'const label: string = "util"',
      'console.log(label)',
      'export {}',
      ''
    ].join('\n')
  )

  write(
    'lib/widget.ts',
    [
      'import {shout} from "tiny-pkg"',
      'import {WORD} from "./word"',
      'export const MESSAGE: string = shout(WORD)',
      'document.getElementById("out")!.textContent = MESSAGE',
      ''
    ].join('\n')
  )

  write('lib/word.ts', 'export const WORD: string = "root-absolute"\n')
  write(
    'node_modules/tiny-pkg/package.json',
    JSON.stringify({name: 'tiny-pkg', version: '1.0.0', main: 'index.js'})
  )

  write(
    'node_modules/tiny-pkg/index.js',
    'exports.shout = function shout(s) { return String(s).toUpperCase(); };\n'
  )

  write('vendor/classic.js', CLASSIC_SRC)
  write('styles/page.css', CSS_SRC)
  write('data/x.json', JSON_SRC)
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
    // Windows lists nested entries with backslashes, the assertions use slashes.
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()

function runAsClassicScript(code: string) {
  const sandbox: Record<string, unknown> = {console: {log() {}}}
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)

  return sandbox
}

// A bare specifier or a relative import left in the output cannot resolve
// from chrome-extension://, whichever way the file is loaded.
function expectNoUnresolvedImports(code: string) {
  expect(code).not.toMatch(/from\s*["']tiny-pkg["']/)
  expect(code).not.toMatch(/from\s*["']\.\/word["']/)
  expect(code).not.toMatch(/^\s*import\s+[^(]/m)
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('build: root-absolute HTML and CSS refs compile JS-like files and copy the rest (real rspack)', () => {
  it('compiles the root-absolute module with its bare and TypeScript imports resolved', async () => {
    const summary = await buildFixture('production')

    if (process.env.EXTJS_DUMP_ROOT_ABS) {
      console.log(`DIST FILES\n${listDist().join('\n')}`)

      for (const rel of [
        'scripts/util.js',
        'lib/widget.js',
        'action/index.html'
      ]) {
        console.log(
          `\n--- ${rel} ---\n${exists(rel) ? read(rel).slice(0, 800) : '(absent)'}`
        )
      }

      console.log('WARNINGS', JSON.stringify(summary.warnings, null, 2))
    }

    expect(summary.errors_count).toBe(0)

    // The missing-file check runs before the child compilation emits
    // lib/widget.js, so it must credit the lib/widget.ts sibling instead of
    // flagging a file that will exist.
    expect(
      (summary.warnings || []).filter((message) =>
        message.includes("doesn't exist")
      )
    ).toEqual([])

    expect(exists('lib/widget.js'), 'missing lib/widget.js').toBe(true)
    const widget = read('lib/widget.js')
    expectNoUnresolvedImports(widget)
    expect(widget).not.toContain(': string')
    expect(widget).toContain('toUpperCase')
    expect(widget).toContain('"root-absolute"')
    // Loaded by <script type="module">, so it stays an ES module and keeps
    // its export.
    const ast = acorn.parse(widget, {
      ecmaVersion: 'latest',
      sourceType: 'module'
    }) as unknown as {body: Array<{type: string}>}
    expect(ast.body.some((node) => /^Export/.test(node.type))).toBe(true)
    // The imports travel inside the file, not as raw siblings.
    expect(exists('lib/widget.ts')).toBe(false)
    expect(exists('lib/word.ts')).toBe(false)
    expect(exists('lib/word.js')).toBe(false)
  }, 120_000)

  it('ships the scripts/ source referenced as .ts once, compiled, and warns about the spelling', async () => {
    const summary = await buildFixture('production')
    expect(listDist().filter((rel) => rel.startsWith('scripts/util'))).toEqual([
      'scripts/util.js'
    ])

    const util = read('scripts/util.js')
    expect(util).not.toContain(': string')
    expectNoUnresolvedImports(util)
    expect(util).toContain('util')

    const spelling = (summary.warnings || []).filter((message) =>
      message.includes('/scripts/util.ts is compiled to scripts/util.js')
    )
    expect(spelling).toHaveLength(1)
    expect(spelling[0]).toContain(
      "loads '/scripts/util.ts' via an HTML src/href attribute"
    )
  }, 120_000)

  it('copies the stylesheet, the data file it names and the classic script byte for byte', () => {
    expect(read('styles/page.css')).toBe(CSS_SRC)
    expect(read('data/x.json')).toBe(JSON_SRC)
    expect(read('vendor/classic.js')).toBe(CLASSIC_SRC)
    // Verbatim means the side-by-side globals a classic script declares survive.
    const globals = runAsClassicScript(read('vendor/classic.js'))
    expect(globals.VENDOR_READY).toBe(true)
    expect(typeof globals.vendorHello).toBe('function')
  })

  it('emits nothing under a source spelling', () => {
    expect(
      listDist().filter((rel) => /\.(?:ts|tsx|mts|cts)$/.test(rel))
    ).toEqual([])
  })

  it('does the same in a development build', async () => {
    const summary = await buildFixture('development')
    expect(summary.errors_count).toBe(0)
    expect(
      (summary.warnings || []).filter((message) =>
        message.includes("doesn't exist")
      )
    ).toEqual([])

    const widget = read('lib/widget.js')
    expectNoUnresolvedImports(widget)
    expect(widget).toContain('toUpperCase')
    expect(widget).toContain('"root-absolute"')
    expect(read('scripts/util.js')).not.toContain(': string')
    expect(read('data/x.json')).toBe(JSON_SRC)
    expect(read('vendor/classic.js')).toBe(CLASSIC_SRC)
    expect(listDist().filter((rel) => /\.ts$/.test(rel))).toEqual([])
  }, 120_000)
})
