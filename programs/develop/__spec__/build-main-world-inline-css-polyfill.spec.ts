import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const POLYFILL_GUARD = 'only be loaded in a browser extension'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-world-css-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'main-world', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'styles.css'),
    '.card {\n  background-color: #0a0c10;\n}\n'
  )

  fs.writeFileSync(
    path.join(root, 'content.js'),
    [
      'export default function initial() {',
      "  const cssUrl = new URL('./styles.css', import.meta.url)",
      '  fetch(cssUrl).then((response) => response.text()).then((css) => {',
      "    const style = document.createElement('style')",
      '    style.textContent = css',
      '    document.head.appendChild(style)',
      '  })',
      '}',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'main-world',
      version: '1.0.0',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content.js'], world: 'MAIN'}
      ]
    })
  )

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      polyfill: true,
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const entry = manifest.content_scripts.find(
    (script: {world?: string}) => script.world === 'MAIN'
  )
  expect(entry, JSON.stringify(manifest.content_scripts)).toBeDefined()

  return fs.readFileSync(path.join(distDir, entry.js[0]), 'utf8')
}

function runInMainWorld(code: string) {
  const fetched: string[] = []
  const element = () => ({
    textContent: '',
    style: {},
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    remove() {}
  })
  const documentLike = {
    readyState: 'complete',
    baseURI: 'https://example.com/',
    documentElement: {getAttribute: () => null, setAttribute() {}},
    head: {appendChild() {}},
    body: {appendChild() {}},
    createElement: element,
    createTextNode: () => ({}),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    addEventListener() {},
    removeEventListener() {}
  }
  const sandbox: Record<string, unknown> = {
    console: {log() {}, warn() {}, error() {}, info() {}, debug() {}},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentLike,
    location: {href: 'https://example.com/', origin: 'https://example.com'},
    __EXTJS_EXTENSION_BASE__: 'chrome-extension://abc/',
    fetch: (url: URL | string) => {
      fetched.push(String(url))
      const text = decodeURIComponent(String(url).split(',').slice(1).join(','))

      return Promise.resolve({ok: true, text: () => Promise.resolve(text)})
    },
    URL,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    Error,
    TypeError,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Function,
    Symbol,
    Map,
    Set,
    WeakMap,
    JSON,
    Math,
    Date,
    RegExp
  }
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(code, sandbox, {timeout: 5000})

  return {fetched}
}

describe('a MAIN world content script keeps its inlined stylesheet under the polyfill', () => {
  it('bundles the sheet as a data: URL with no webextension-polyfill in the chunk', async () => {
    const dev = await build(project(), 'development')
    const prod = await build(project(), 'production')

    for (const chunk of [dev, prod]) {
      expect(chunk).toContain('data:text/css')
      expect(chunk).not.toContain(POLYFILL_GUARD)
    }
  }, 180_000)

  it('hands fetch the sheet in a world with no extension API', async () => {
    const chunk = await build(project(), 'development')
    const {fetched} = runInMainWorld(chunk)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fetched).toHaveLength(1)
    expect(fetched[0].startsWith('data:text/css')).toBe(true)
    expect(decodeURIComponent(fetched[0])).toContain('#0a0c10')
  }, 180_000)
})
