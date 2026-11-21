import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

// The polyfill throws on load where no extension API exists, so it is only
// provided to bundles that run inside the extension.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// The first statement of the polyfill, which only its own module carries.
const POLYFILL_MARK = 'This script should only be loaded in a browser extension'

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    private: true,
    name: 'polyfill-bundles',
    version: '0.0.0'
  }),
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'polyfill-bundles',
    version: '1.0.0',
    background: {service_worker: 'background.js'},
    action: {default_popup: 'popup.html'},
    permissions: ['scripting'],
    content_scripts: [
      {matches: ['<all_urls>'], js: ['isolated.js']},
      {matches: ['<all_urls>'], js: ['main.js'], world: 'MAIN'}
    ],
    sandbox: {pages: ['sandbox.html']}
  }),
  'background.js':
    'browser.runtime.onInstalled.addListener(() => {})\n' +
    'chrome.scripting.registerContentScripts([{id: "registered", ' +
    'matches: ["<all_urls>"], js: ["scripts/registered.js"], world: "MAIN"}])\n' +
    'chrome.scripting.registerContentScripts([' +
    '{id: "both-isolated", matches: ["<all_urls>"], js: ["scripts/both.js"]}, ' +
    '{id: "both-main", matches: ["<all_urls>"], js: ["scripts/both.js"], world: "MAIN"}])\n',
  'scripts/registered.js': 'window.__REGISTERED__ = typeof browser\n',
  // Both worlds run this file, so each gets its own build of it.
  'scripts/both.js': 'window.__BOTH__ = typeof browser\n',
  'isolated.js': "browser.runtime.sendMessage('from the isolated world')\n",
  'main.js':
    "import {pageHasBrowser} from './main-helper.js'\n" +
    "window.__MAIN_WORLD__ = typeof browser + ' ' + pageHasBrowser()\n",
  'main-helper.js':
    "export const pageHasBrowser = () => typeof browser !== 'undefined'\n",
  'sandbox.html':
    '<!doctype html><html><head><title>sandbox</title></head>' +
    '<body><script src="./sandbox.js"></script></body></html>',
  'sandbox.js':
    "import {sandboxHelper} from './sandbox-helper.js'\n" +
    "window.__SANDBOX__ = typeof browser + ' ' + sandboxHelper()\n",
  'sandbox-helper.js': 'export const sandboxHelper = () => typeof browser\n',
  // A page with the extension API that shares the sandbox page's import.
  'popup.html':
    '<!doctype html><html><head><title>popup</title></head>' +
    '<body><script src="./popup.js"></script></body></html>',
  'popup.js':
    "import {sandboxHelper} from './sandbox-helper.js'\n" +
    'window.__POPUP__ = sandboxHelper()\n'
}

type Built = {
  background: string
  isolated: string
  main: string
  registered: string
  bothIsolated: string
  bothMain: string
  sandbox: string
  popup: string
}

async function build(mode: 'development' | 'production'): Promise<Built> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-polyfill-worlds-'))
  roots.push(root)

  for (const [name, source] of Object.entries(FILES)) {
    const file = path.join(root, ...name.split('/'))

    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, source)
  }

  const {extensionBuild} = await import('../../command-build')
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
    } as Parameters<typeof extensionBuild>[1])

    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const dist = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )
  const read = (file: string) =>
    fs.readFileSync(path.join(dist, ...file.split('/')), 'utf8')
  const scriptsOf = (world?: string) =>
    manifest.content_scripts
      .filter((script: {world?: string}) => script.world === world)
      .flatMap((script: {js: string[]}) => script.js)
      .map(read)
      .join('\n')

  const pageScripts = (page: string) => {
    const scripts = [...read(page).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
      .map((match) => match[1].replace(/^\//, ''))
      .map((src) => path.posix.join(path.posix.dirname(page), src))
      .map((file) =>
        fs.existsSync(path.join(dist, ...file.split('/')))
          ? read(file)
          : read(file.replace(/^.*?\//, ''))
      )

    expect(scripts.length).toBeGreaterThan(0)

    return scripts.join('\n')
  }

  return {
    background: read(manifest.background.service_worker),
    isolated: scriptsOf(undefined),
    main: scriptsOf('MAIN'),
    registered: read('scripts/registered.js'),
    bothIsolated: read('scripts/both.js'),
    bothMain: read('scripts/both.extjs-main-world.js'),
    sandbox: pageScripts(manifest.sandbox.pages[0] as string),
    popup: pageScripts(manifest.action.default_popup as string)
  }
}

// A page with no extension API: no chrome.runtime, no browser.
function runOnPage(code: string): Record<string, unknown> {
  const page: Record<string, unknown> = {
    console: {log() {}, warn() {}, error() {}, info() {}, debug() {}},
    document: {
      readyState: 'complete',
      baseURI: 'https://example.com/',
      documentElement: {getAttribute: () => null, setAttribute() {}},
      head: {appendChild() {}},
      body: {appendChild() {}},
      createElement: () => ({setAttribute() {}, appendChild() {}}),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementsByTagName: () => [],
      addEventListener() {},
      removeEventListener() {}
    },
    location: {href: 'https://example.com/', origin: 'https://example.com'},
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    Error,
    TypeError,
    Object,
    Array,
    String,
    Symbol,
    Map,
    Set,
    WeakMap,
    Proxy,
    Reflect,
    JSON
  }
  page.self = page
  page.window = page
  page.globalThis = page
  vm.runInNewContext(code, page, {timeout: 5000})

  return page
}

describe.each([
  'production',
  'development'
] as const)('the polyfill with polyfill on, %s build', (mode) => {
  let built: Built

  it('builds the fixture', async () => {
    built = await build(mode)
  }, 180_000)

  it('is in the background and the isolated content script', () => {
    expect(built.background.includes(POLYFILL_MARK)).toBe(true)
    expect(built.isolated.includes(POLYFILL_MARK)).toBe(true)
  })

  it('stays out of the MAIN world content script and its imports', () => {
    expect(built.main.includes(POLYFILL_MARK)).toBe(false)
  })

  it('stays out of the sandbox page script and its imports', () => {
    expect(built.sandbox.includes(POLYFILL_MARK)).toBe(false)
  })

  it('stays in a page that shares an import with the sandbox page', () => {
    expect(built.popup.includes(POLYFILL_MARK)).toBe(true)
  })

  it('stays out of a scripts/ file registered into the MAIN world', () => {
    expect(built.registered.includes(POLYFILL_MARK)).toBe(false)
    expect(runOnPage(built.registered).__REGISTERED__).toBe('undefined')
  })

  it('stays out of the MAIN copy of a scripts/ file both worlds run', () => {
    expect(built.bothIsolated.includes(POLYFILL_MARK)).toBe(true)
    expect(built.bothMain.includes(POLYFILL_MARK)).toBe(false)
    expect(runOnPage(built.bothMain).__BOTH__).toBe('undefined')
  })

  it('leaves browser undefined on the page, as without the option', () => {
    const page = runOnPage(built.main)

    expect(page.__MAIN_WORLD__).toBe('undefined false')
  })
})
