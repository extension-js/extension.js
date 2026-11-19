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
    content_scripts: [
      {matches: ['<all_urls>'], js: ['isolated.js']},
      {matches: ['<all_urls>'], js: ['main.js'], world: 'MAIN'}
    ],
    sandbox: {pages: ['sandbox.html']}
  }),
  'background.js': 'browser.runtime.onInstalled.addListener(() => {})\n',
  'isolated.js': "browser.runtime.sendMessage('from the isolated world')\n",
  'main.js':
    "import {pageHasBrowser} from './main-helper.js'\n" +
    "window.__MAIN_WORLD__ = typeof browser + ' ' + pageHasBrowser()\n",
  'main-helper.js':
    "export const pageHasBrowser = () => typeof browser !== 'undefined'\n",
  'sandbox.html':
    '<!doctype html><html><head><title>sandbox</title></head>' +
    '<body><script src="./sandbox.js"></script></body></html>',
  'sandbox.js': 'window.__SANDBOX__ = typeof browser\n'
}

type Built = {
  background: string
  isolated: string
  main: string
  sandbox: string
}

async function build(mode: 'development' | 'production'): Promise<Built> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-polyfill-worlds-'))
  roots.push(root)

  for (const [name, source] of Object.entries(FILES)) {
    fs.writeFileSync(path.join(root, name), source)
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
    } as any)

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
  const sandboxPage = manifest.sandbox.pages[0] as string
  const sandboxScripts = [
    ...read(sandboxPage).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)
  ]
    .map((match) => match[1].replace(/^\//, ''))
    .map((src) => path.posix.join(path.posix.dirname(sandboxPage), src))
    .map((file) =>
      fs.existsSync(path.join(dist, ...file.split('/')))
        ? read(file)
        : read(file.replace(/^.*?\//, ''))
    )

  expect(sandboxScripts.length).toBeGreaterThan(0)

  return {
    background: read(manifest.background.service_worker),
    isolated: scriptsOf(undefined),
    main: scriptsOf('MAIN'),
    sandbox: sandboxScripts.join('\n')
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

  it('stays out of the sandbox page script', () => {
    expect(built.sandbox.includes(POLYFILL_MARK)).toBe(false)
  })

  it('leaves browser undefined on the page, as without the option', () => {
    const page = runOnPage(built.main)

    expect(page.__MAIN_WORLD__).toBe('undefined false')
  })
})
