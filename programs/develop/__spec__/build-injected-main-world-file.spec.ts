import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'
import {readTakeBlock} from '../lib/extension-base-from-stack'

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
    document: {
      documentElement: html,
      body: {appendChild() {}},
      readyState: 'complete'
    },
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

// The two files the background injects into the MAIN world.
const TAKING = ['scripts/value.js', 'scripts/hook.js']

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

  it('firefox: a MAIN world file opens on the read that takes the base and still ends on its value', async () => {
    const built = await build(project(VALUE_FILES), 'firefox')
    const names = Object.keys(VALUE_FILES)
      .filter((name) => name.startsWith('scripts/'))
      .map((name) => name.replace(/\.ts$/, '.js'))
    const taking = names.filter((name) => readTakeBlock(built.read(name)))

    expect(taking).toEqual(TAKING)

    for (const name of taking) {
      expect(
        built.read(name).split(String(readTakeBlock(built.read(name)))),
        name
      ).toHaveLength(2)
    }

    expect(
      built
        .read('scripts/value.js')
        .startsWith(
          `${readTakeBlock(built.read('scripts/value.js'))}{let __extjsCompletionValue`
        )
    ).toBe(true)

    expect(runOnPage(built.read('scripts/value.js')).value).toBe(42)

    // A failed import asks no bridge, which would answer the page as well.
    expect(built.read(BRIDGE)).toContain('moz-extension:')

    for (const name of names) {
      expect(built.read(name), name).not.toContain('EXTJS_WTW_LOAD')
    }
  }, 180_000)

  it('chrome: no file opens on that read', async () => {
    const built = await build(project(VALUE_FILES), 'chrome')

    for (const name of Object.keys(VALUE_FILES)) {
      if (!name.startsWith('scripts/')) continue

      const text = built.read(name.replace(/\.ts$/, '.js'))

      expect(text, name).not.toContain('__extjsTakenBase')
    }
  }, 180_000)
})

const tabCall = (file: string) =>
  'api.tabs.onUpdated.addListener(function (tabId) {\n' +
  `  api.scripting.executeScript({target: {tabId: tabId}, files: ["${file}"]})\n})\n`

const MOUNTED_FILES = {
  'scripts/mounted.js':
    'const count = 20\n' +
    'export default function start() {\n' +
    '  document.documentElement.dataset.mounted = String(count)\n' +
    '  return "returned-by-default"\n}\n' +
    'count + 22\n',
  'scripts/mounted-value.js': 'const count = 20\nexport default count + 22\n',
  'scripts/mounted-later.js':
    'export default async function start() {\n' +
    '  document.documentElement.dataset.later = "1"\n' +
    '  return "returned-by-async-default"\n}\n',
  'injected/typed.ts': 'const typedCount: number = 20\ntypedCount + 22\n',
  'injected/quiet.ts':
    'const quietCount: number = 20\n' +
    'function quietHelper(): number { return quietCount }\n',
  'injected/plain.js': 'const plainCount = 20\nplainCount + 22\n',
  'background.js':
    API +
    tabCall('/scripts/mounted.js') +
    tabCall('/scripts/mounted-value.js') +
    tabCall('/scripts/mounted-later.js') +
    tabCall('/injected/typed.js') +
    tabCall('/injected/quiet.js') +
    tabCall('/injected/plain.js')
}

describe('the value an injected file with a default export ends on', () => {
  it.each([
    'chrome',
    'firefox'
  ] as const)('%s: the file is an entry the wrapper mounts, so it ends on nothing', async (browser) => {
    const built = await build(project(MOUNTED_FILES), browser)
    const mounted = runOnPage(built.read('scripts/mounted.js'))
    const html = (mounted.page.document as any).documentElement

    // The default export ran, and neither its return value nor the last
    // statement nor an object of the wrapper comes back as the result.
    expect(html.dataset.mounted).toBe('20')
    expect(mounted.value).toBeUndefined()
    expect(runOnPage(built.read('scripts/mounted-value.js')).value).toBe(
      undefined
    )

    const later = runOnPage(built.read('scripts/mounted-later.js'))

    expect((later.page.document as any).documentElement.dataset.later).toBe('1')
    expect(later.value).toBeUndefined()

    for (const name of Object.keys(MOUNTED_FILES)) {
      if (!name.startsWith('scripts/')) continue

      expect(built.read(name), name).not.toContain('__extjsCompletion')
    }
  }, 180_000)
})

describe('the value a file injected from outside scripts/ ends on', () => {
  it.each([
    'chrome',
    'firefox'
  ] as const)('%s: a compiled file ends on its last statement, a copied one is left as written', async (browser) => {
    const built = await build(project(MOUNTED_FILES), browser)
    const typed = runOnPage(built.read('injected/typed.js'))

    expect(typed.value).toBe(42)
    expect(typed.page.typedCount).toBe(20)

    const quiet = runOnPage(built.read('injected/quiet.js'))

    // Its last shared name is a function, a value no browser can clone.
    expect(quiet.value).toBeUndefined()
    expect(typeof quiet.page.quietHelper).toBe('function')
    expect(quiet.page.quietCount).toBe(20)

    expect(built.read('injected/plain.js').replace(/\r\n/g, '\n')).toBe(
      MOUNTED_FILES['injected/plain.js']
    )

    expect(runOnPage(built.read('injected/plain.js')).value).toBe(42)
  }, 180_000)
})
