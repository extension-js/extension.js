import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import * as acorn from 'acorn'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// A runtime-loaded module (a getURL target, a root-absolute page module) is
// fetched at one known path, so its import.meta.url must be that path. The
// page-or-root guess main entries get would send wasm, model and worker
// glue that resolves siblings from import.meta.url to the wrong folder.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-traced-meta-url-'))

function write(rel: string, content: string) {
  const abs = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, content)
}

function writeFixture() {
  write(
    'package.json',
    JSON.stringify({
      private: true,
      name: 'extjs-traced-meta-url-spec',
      version: '0.0.0'
    })
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Build Spec, traced import.meta.url',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}],
      web_accessible_resources: [
        {resources: ['lib/*'], matches: ['<all_urls>']}
      ]
    })
  )

  // A main entry keeps the runtime guess.
  write('background.js', 'console.log("BG_META_MARK", import.meta.url)\n')

  // A content script reaches an ES module through getURL.
  write(
    'content.js',
    'import(chrome.runtime.getURL("lib/engine.js")).then((m) => console.log(m.dir))\n'
  )

  write(
    'lib/engine.js',
    [
      'export const url = import.meta.url',
      'export const dir = import.meta.url.replace(/[^/]*$/, "")',
      ''
    ].join('\n')
  )

  // A popup loads a page module by root-absolute path, the popup itself
  // relocates under action/ while the module keeps its own path.
  write(
    'popup.html',
    '<!doctype html><html><body><script type="module" src="/lib/page.js"></script></body></html>\n'
  )

  write('lib/page.js', 'export const pageUrl = import.meta.url\n')
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
const listDist = () =>
  fs
    .readdirSync(distDir(), {recursive: true})
    .map(String)
    .filter((rel) => fs.statSync(path.join(distDir(), rel)).isFile())
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()

// The project path in slash form, which is how a file:// leak would spell it.
const projectNeedles = () =>
  [ROOT, fs.realpathSync(ROOT)].map((dir) =>
    dir.split(path.sep).join('/').replace(/^\/+/, '')
  )

interface AcornNode {
  type: string
  start: number
  end: number
  declaration?: AcornNode | null
  source?: AcornNode | null
  specifiers?: Array<{local: {name: string}; exported: {name: string}}>
}

// Runs an emitted ES module in a fresh realm and returns its exports. The
// export statements become assignments so plain vm can execute the file.
function runAsModule(code: string, globals: Record<string, unknown>) {
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module'
  }) as unknown as {body: AcornNode[]}
  let rewritten = code

  for (const node of [...ast.body].reverse()) {
    if (node.type !== 'ExportNamedDeclaration' || node.source) continue

    let replacement = ''

    if (node.declaration) {
      replacement = code.slice(node.declaration.start, node.declaration.end)
    } else {
      replacement = (node.specifiers || [])
        .map(
          (spec) =>
            `__exports__[${JSON.stringify(spec.exported.name)}]=${spec.local.name};`
        )
        .join('')
    }

    rewritten =
      rewritten.slice(0, node.start) + replacement + rewritten.slice(node.end)
  }

  const exported: Record<string, unknown> = {}
  const sandbox: Record<string, unknown> = {
    console: {log() {}},
    __exports__: exported,
    ...globals
  }
  vm.createContext(sandbox)
  vm.runInContext(rewritten, sandbox)

  return exported
}

const fakeChrome = {
  runtime: {getURL: (p: string) => `chrome-extension://abc/${p}`}
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('build: runtime-loaded modules own their import.meta.url (real rspack)', () => {
  it('points a getURL module and a root-absolute page module at their emit paths', async () => {
    const summary = await buildFixture('production')
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(0)

    const engine = read('lib/engine.js')
    const page = read('lib/page.js')
    expect(engine).toContain('getURL("lib/engine.js")')
    expect(page).toContain('getURL("lib/page.js")')

    for (const rel of listDist()) {
      const content = read(rel)
      expect(content, rel).not.toContain('file://')

      for (const needle of projectNeedles()) {
        expect(content.split('\\').join('/'), rel).not.toContain(needle)
      }
    }
  }, 120_000)

  it('resolves to the module URL at runtime, with siblings next to it', () => {
    const engine = runAsModule(read('lib/engine.js'), {chrome: fakeChrome})
    expect(engine.url).toBe('chrome-extension://abc/lib/engine.js')
    expect(engine.dir).toBe('chrome-extension://abc/lib/')

    const page = runAsModule(read('lib/page.js'), {chrome: fakeChrome})
    expect(page.pageUrl).toBe('chrome-extension://abc/lib/page.js')
  })

  it('falls back to the page URL where no extension runtime exists', () => {
    const engine = runAsModule(read('lib/engine.js'), {
      document: {baseURI: 'https://example.com/article'}
    })
    expect(engine.url).toBe('https://example.com/article')
  })

  it('keeps the runtime guess for a main entry', () => {
    const background = listDist().find((rel) =>
      read(rel).includes('BG_META_MARK')
    )
    expect(background, listDist().join(',')).toBeDefined()
    const code = read(String(background))
    expect(code).toContain('document.baseURI')
    expect(code).not.toMatch(/getURL\("background/)
  })

  it('does the same in a development build', async () => {
    const summary = await buildFixture('development')
    expect(summary.errors_count).toBe(0)

    const engine = read('lib/engine.js')
    expect(engine).toContain('getURL("lib/engine.js")')
    expect(engine).not.toContain('file://')
    expect(read('lib/page.js')).toContain('getURL("lib/page.js")')

    const exported = runAsModule(engine, {chrome: fakeChrome})
    expect(exported.dir).toBe('chrome-extension://abc/lib/')
  }, 120_000)
})
