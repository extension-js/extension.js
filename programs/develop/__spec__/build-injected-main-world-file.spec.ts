import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

// An injected MAIN world file reads the extension base off the page on
// Gecko, so the caller's bundle runs the bridge ahead of the injection.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const API = 'var api = globalThis.browser || globalThis.chrome\n'

const inject = (world: string) =>
  `${API}api.tabs.onUpdated.addListener(function (tabId) {\n` +
  '  api.scripting.executeScript({target: {tabId: tabId}, ' +
  `files: ["/scripts/hook.js"], world: "${world}"})\n})\n`

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-injected-main-'))
  roots.push(root)

  const all: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'injected-main',
      version: '0.0.0'
    }),
    'media/blob.bin': Buffer.alloc(40_000),
    'scripts/hook.js':
      'import blobUrl from "../media/blob.bin?url"\n' +
      'window.__PAGE_HOOK__ = String(blobUrl)\n',
    'background.js': 'console.log("INJECTED_MAIN_BACKGROUND")\n',
    'options/index.html':
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<script src="./options.js"></script></body></html>\n',
    'options/options.js': 'document.title = "INJECTED_MAIN_OPTIONS"\n',
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'injected-main',
      version: '1.0.0',
      permissions: ['scripting', 'tabs'],
      host_permissions: ['<all_urls>'],
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      options_ui: {page: 'options/index.html', open_in_tab: true},
      browser_specific_settings: {gecko: {id: 'injected-main@example.com'}}
    }),
    ...files
  }

  for (const [name, contents] of Object.entries(all)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)

  return {
    read: (file: string) => fs.readFileSync(path.join(distDir, file), 'utf8'),
    has: (file: string) => fs.existsSync(path.join(distDir, file))
  }
}

const EXECUTE_WRAP = 'scripting.executeScript = function'
const BRIDGED_FILES = 'var INJECTABLE = ["scripts/hook.js"];'
const BRIDGE = 'scripts/extjs-main-world-bridge.js'

describe('a MAIN world file the extension injects with executeScript', () => {
  it('firefox: the background runs the bridge ahead of its injection', async () => {
    const built = await build(
      project({'background.js': inject('MAIN')}),
      'firefox'
    )
    const background = built.read('background/scripts.js')

    expect(built.has(BRIDGE)).toBe(true)
    expect(background).toContain(EXECUTE_WRAP)
    expect(background).toContain(BRIDGED_FILES)
    expect(background).toContain(`var FILE = "${BRIDGE}";`)
    expect(built.read('options/index.js')).not.toContain(EXECUTE_WRAP)
  }, 180_000)

  it('firefox: a page that injects names the bridge from the root', async () => {
    const built = await build(
      project({'options/options.js': inject('MAIN')}),
      'firefox'
    )
    const page = built.read('options/index.js')

    expect(built.has(BRIDGE)).toBe(true)
    expect(page).toContain(EXECUTE_WRAP)
    expect(page).toContain(BRIDGED_FILES)
    expect(page).toContain(`var FILE = "/${BRIDGE}";`)
  }, 180_000)

  it('firefox: an injection outside the MAIN world wraps nothing', async () => {
    const built = await build(
      project({
        'background.js': inject('ISOLATED'),
        'options/options.js': inject('ISOLATED')
      }),
      'firefox'
    )

    expect(built.has(BRIDGE)).toBe(false)
    expect(built.read('background/scripts.js')).not.toContain(EXECUTE_WRAP)
    expect(built.read('options/index.js')).not.toContain(EXECUTE_WRAP)
  }, 180_000)

  it('chrome: never wraps, the file reads the base off its own stack', async () => {
    const built = await build(
      project({
        'background.js': inject('MAIN'),
        'options/options.js': inject('MAIN')
      }),
      'chrome'
    )

    expect(built.has(BRIDGE)).toBe(false)
    expect(built.read('background/service_worker.js')).not.toContain(
      EXECUTE_WRAP
    )

    expect(built.read('options/index.js')).not.toContain(EXECUTE_WRAP)
  }, 180_000)
})

// The page an injected file meets, as far as these files look at it.
function runOnPage(code: string) {
  const attributes: Record<string, string> = {}
  const html = {
    dataset: {} as Record<string, string>,
    childElementCount: 2,
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
    removeAttribute: (name: string) => delete attributes[name]
  }
  const page: Record<string, unknown> = {
    // A stand-in for a DOM node: an object the structured clone refuses.
    document: {documentElement: html, body: {appendChild() {}}},
    setTimeout,
    Promise,
    structuredClone
  }
  page.window = page
  page.globalThis = page

  return {value: vm.runInNewContext(code, page), page}
}

const VALUE_FILES = {
  'scripts/value.js': 'window.__VALUE__ = 1\n42\n',
  'scripts/typed.ts':
    'const count: number = Number(document.documentElement.childElementCount)\n' +
    'if (count > 0) {\n  "from-if"\n} else {\n  "from-else"\n}\n',
  'scripts/node.js': 'document.body\n',
  'scripts/later.js': 'Promise.resolve(document.body)\n',
  'scripts/named.js': ';(function named() {})\n',
  'scripts/map.js': 'new Map([[1, {a: 1}]])\n',
  'scripts/quiet.js': 'var quiet = 1\nfunction unused() { return quiet }\n',
  'scripts/hook.js':
    'import blobUrl from "../media/blob.bin?url"\n' +
    'window.__PAGE_HOOK__ = String(blobUrl)\n' +
    ';({hook: String(blobUrl)})\n',
  'background.js':
    'import "./scripts/value.js"\n' +
    inject('MAIN') +
    'api.tabs.onUpdated.addListener(function (tabId) {\n' +
    '  api.scripting.executeScript({target: {tabId: tabId}, ' +
    'files: ["/scripts/value.js"], world: "MAIN"})\n})\n'
}

describe('the value an injected scripts/ file ends on', () => {
  it.each([
    'chrome',
    'firefox'
  ] as const)('%s: the emitted file ends on it, for either world', async (browser) => {
    const built = await build(project(VALUE_FILES), browser)

    expect(runOnPage(built.read('scripts/value.js')).value).toBe(42)
    expect(runOnPage(built.read('scripts/typed.js')).value).toBe('from-if')

    const hook = runOnPage(built.read('scripts/hook.js'))

    expect(hook.value).toEqual({hook: hook.page.__PAGE_HOOK__})
    expect(String(hook.page.__PAGE_HOOK__)).toContain('assets/blob.')

    // Nothing but what the file itself set is left on the page.
    expect(
      Object.keys(runOnPage(built.read('scripts/value.js')).page).sort()
    ).toEqual([
      'Promise',
      '__VALUE__',
      'document',
      'globalThis',
      'setTimeout',
      'structuredClone',
      'window'
    ])

    // A value the browser cannot clone ends the file on nothing, so no
    // call that resolved before this value was kept starts to reject.
    expect(runOnPage(built.read('scripts/node.js')).value).toBeUndefined()
    expect(runOnPage(built.read('scripts/named.js')).value).toBeUndefined()
    expect(
      await runOnPage(built.read('scripts/later.js')).value
    ).toBeUndefined()

    expect(runOnPage(built.read('scripts/map.js')).value.get(1)).toEqual({a: 1})

    // A file that ends on no value ships the bytes it always did.
    expect(runOnPage(built.read('scripts/quiet.js')).value).toBeUndefined()
    expect(built.read('scripts/quiet.js')).not.toContain('__extjsCompletion')

    // A bundle that only imports the file is no injected file itself.
    const background = built.read(
      browser === 'chrome'
        ? 'background/service_worker.js'
        : 'background/scripts.js'
    )

    expect(background).not.toContain('let __extjsCompletionValue')
    expect(background).toContain('typeof __extjsCompletion')
  }, 180_000)
})
