import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'
import {SFC_STYLE_ATTRIBUTE} from '../plugin-css/css-lib/inline-content-script-css'
import {SHEET_BLOCK_OPEN} from '../plugin-web-extension/feature-scripts/scripts-lib/runtime-script-sheet'

// The author's own call injects a scripts/ file and names only that file,
// so the sheet of the CSS modules it imports has to arrive with it.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-runtime-sheet-'))
  roots.push(root)

  const files: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'runtime-sheet',
      version: '0.0.0'
    }),
    'media/pic.bin': Buffer.alloc(40_000),
    'styles/hook.module.css':
      '.probe { color: rgb(1, 2, 3); background-image: url(../media/pic.bin); }\n',
    'styles/shared.module.css': '.shared { color: rgb(4, 5, 6); }\n',
    'scripts/hook.js':
      'import hook from "../styles/hook.module.css"\n' +
      'import shared from "../styles/shared.module.css"\n' +
      'globalThis.__HOOK_CLASSES__ = [hook.probe, shared.shared]\n',
    'scripts/plain.js': 'globalThis.__PLAIN__ = 1\n',
    'content/declared.js':
      'import shared from "../styles/shared.module.css"\n' +
      'globalThis.__DECLARED_CLASS__ = shared.shared\n',
    'background.js':
      'var api = globalThis.browser || globalThis.chrome\n' +
      'api.scripting.registerContentScripts([{id: "hook", ' +
      'js: ["/scripts/hook.js"], matches: ["<all_urls>"]}])\n' +
      'api.tabs.onUpdated.addListener(function (tabId) {\n' +
      '  api.scripting.executeScript({target: {tabId: tabId}, ' +
      'files: ["/scripts/plain.js"]})\n})\n',
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'runtime-sheet',
      version: '1.0.0',
      permissions: ['scripting', 'tabs'],
      host_permissions: ['<all_urls>'],
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      content_scripts: [{matches: ['<all_urls>'], js: ['content/declared.js']}],
      browser_specific_settings: {gecko: {id: 'runtime-sheet@example.com'}}
    })
  }

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, ...name.split('/'))
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  return root
}

async function build(browser: 'chrome' | 'firefox') {
  const root = project()
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
  const at = (file: string) => path.join(distDir, ...file.split('/'))

  return {
    read: (file: string) => fs.readFileSync(at(file), 'utf8'),
    has: (file: string) => fs.existsSync(at(file))
  }
}

// The file as the browser runs it in an isolated world of a page.
function inject(code: string, root: string) {
  const placed: Array<{attrs: Record<string, string>; textContent: string}> = []
  const runtime = {getURL: (file: string) => root + file.replace(/^\//, '')}
  const context: Record<string, unknown> = {
    chrome: {runtime},
    browser: {runtime},
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    console,
    document: {
      head: {
        appendChild(el: (typeof placed)[number] & {sheet: unknown}) {
          placed.push(el)
          el.sheet = {}
        }
      },
      documentElement: {
        getAttribute: () => null,
        setAttribute: () => undefined,
        removeAttribute: () => undefined
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      querySelectorAll: () => [],
      querySelector: (selector: string) =>
        placed.find(
          (el) =>
            selector ===
            `style[${SFC_STYLE_ATTRIBUTE}="${el.attrs[SFC_STYLE_ATTRIBUTE]}"]`
        ) || null,
      createElement: () => {
        const attrs: Record<string, string> = {}

        return {
          attrs,
          textContent: '',
          sheet: null,
          setAttribute(name: string, value: string) {
            attrs[name] = value
          }
        }
      }
    }
  }
  context.globalThis = context
  context.window = context
  context.self = context
  vm.runInNewContext(code, context)

  return {
    placed,
    classes: context.__HOOK_CLASSES__ as string[] | undefined
  }
}

describe.each([
  ['chrome', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'],
  ['firefox', 'moz-extension://11111111-2222-3333-4444-555555555555/']
] as const)('a scripts/ file that imports a CSS module, %s', (browser, root) => {
  it('carries the sheet of its class names and ships no file for it', async () => {
    const built = await build(browser)
    const hook = built.read('scripts/hook.js')
    const manifest = JSON.parse(built.read('manifest.json'))

    expect(built.has('scripts/hook.css')).toBe(false)
    expect(JSON.stringify(manifest)).not.toContain('scripts/hook.css')
    expect(hook).toContain(SHEET_BLOCK_OPEN)
    expect(built.read('scripts/plain.js')).not.toContain(SHEET_BLOCK_OPEN)

    const {placed, classes} = inject(hook, root)

    expect(classes).toHaveLength(2)
    expect(placed).toHaveLength(1)

    const sheet = placed[0].textContent

    for (const name of classes || []) {
      expect(name).toMatch(/^[\w-]+$/)
      expect(sheet).toContain(`.${name}{`)
    }

    // The url() names a file the build shipped, under the extension root.
    const file = /url\("?([^")]+)"?\)/.exec(sheet)?.[1] || ''

    expect(file.startsWith(root)).toBe(true)
    expect(built.has(file.slice(root.length))).toBe(true)
    expect(
      manifest.web_accessible_resources.some((group: {resources: string[]}) =>
        group.resources.includes(file.slice(root.length))
      )
    ).toBe(true)
  }, 180_000)

  it('leaves a declared content script on the sheet its manifest entry lists', async () => {
    const built = await build(browser)
    const manifest = JSON.parse(built.read('manifest.json'))
    const declared = built.read('content_scripts/content-0.js')

    expect(manifest.content_scripts[0].css).toEqual([
      'content_scripts/content-0.css'
    ])

    expect(built.read('content_scripts/content-0.css')).toMatch(
      /^\.[\w-]+\{color:#040506\}\s*$/
    )

    expect(declared).not.toContain(SHEET_BLOCK_OPEN)
    expect(declared).not.toContain('#040506')
  }, 180_000)
})
