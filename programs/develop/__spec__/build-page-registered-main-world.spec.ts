import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// An extension page registers MAIN world files through the same scripting
// API as the background, so its registration gets the same build lane.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const page = (...scripts: string[]) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${scripts
    .map((script) => `<script src="${script}"></script>`)
    .join('')}</body></html>\n`

function project(options: {classicPair?: boolean} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-main-reg-'))
  roots.push(root)

  const write = (name: string, contents: string | Buffer) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'page-main-reg', version: '0.0.0'})
  )

  write('media/blob.bin', Buffer.alloc(40_000))
  write('src/chunk.js', 'export const value = "PAGE_MAIN_REG_CHUNK"\n')
  write(
    'scripts/hook.js',
    'import blobUrl from "../media/blob.bin?url"\n' +
      'window.__PAGE_HOOK__ = String(blobUrl)\n' +
      'import("../src/chunk.js").then((m) => (window.__PAGE_CHUNK__ = m.value))\n'
  )

  write('background.js', 'console.log("PAGE_MAIN_REG_BACKGROUND")\n')
  write('popup/index.html', page('./popup.js'))
  write('popup/popup.js', 'document.title = "PAGE_MAIN_REG_POPUP"\n')
  // Two classic scripts on one page enter the build as one joined module.
  write(
    'options/index.html',
    options.classicPair
      ? page('./first.js', './options.js')
      : page('./options.js')
  )

  write('options/first.js', 'var PAGE_MAIN_REG_FIRST = 1\n')
  write(
    'options/options.js',
    [
      'var api = globalThis.browser || globalThis.chrome',
      'api.scripting.registerContentScripts([',
      '  {',
      '    id: "page-hook",',
      '    js: ["/scripts/hook.js"],',
      '    world: "MAIN",',
      '    matches: ["<all_urls>"],',
      '    runAt: "document_start"',
      '  }',
      '])',
      ''
    ].join('\n')
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'page-main-reg',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['<all_urls>'],
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      action: {default_popup: 'popup/index.html'},
      options_ui: {page: 'options/index.html', open_in_tab: true},
      browser_specific_settings: {gecko: {id: 'page-main-reg@example.com'}}
    })
  )

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
  const read = (file: string) =>
    fs.readFileSync(path.join(distDir, file), 'utf8')

  return {
    read,
    has: (file: string) => fs.existsSync(path.join(distDir, file))
  }
}

const PAIRING_MARK = '__extjsMainWorldBridgePaired'
const BRIDGE = 'scripts/extjs-main-world-bridge.js'

describe('a MAIN world script an extension page registers', () => {
  it('chrome: ships without the cleanup hook the isolated wrapper leaves', async () => {
    const built = await build(project(), 'chrome')
    const hook = built.read('scripts/hook.js')

    expect(hook).toContain('__PAGE_HOOK__')
    expect(hook).not.toContain('__EXTENSIONJS_registerCleanup')
  }, 180_000)

  it('chrome: loads its chunks the MAIN world way from a joined page entry', async () => {
    const built = await build(project({classicPair: true}), 'chrome')
    const hook = built.read('scripts/hook.js')

    expect(built.read('options/index.js')).toContain('PAGE_MAIN_REG_FIRST')
    // The isolated loader asks the background, which the page cannot reach.
    expect(hook).toContain('EXTJS_WTW_LOAD')
    expect(hook).not.toContain('__EXTENSIONJS_registerCleanup')
    expect(built.has(BRIDGE)).toBe(false)
    expect(built.read('options/index.js')).not.toContain(PAIRING_MARK)
  }, 180_000)

  it('firefox: the registering page carries the pairing, other pages do not', async () => {
    const built = await build(project(), 'firefox')
    const options = built.read('options/index.js')

    expect(built.has(BRIDGE)).toBe(true)
    expect(options).toContain(PAIRING_MARK)
    // Firefox resolves a relative js path against the page that registers.
    expect(options).toContain(`var FILE = "/${BRIDGE}";`)
    expect(options).toContain('var READERS = ["scripts/hook.js"];')
    expect(options.indexOf(PAIRING_MARK)).toBeLessThan(
      options.indexOf('page-hook')
    )

    expect(built.read('action/index.js')).toContain('PAGE_MAIN_REG_POPUP')
    expect(built.read('action/index.js')).not.toContain(PAIRING_MARK)
    // The background shares the registry, so it keeps hiding the pairs.
    expect(built.read('background/scripts.js')).toContain(PAIRING_MARK)
    expect(built.read('scripts/hook.js')).not.toContain(
      '__EXTENSIONJS_registerCleanup'
    )
  }, 180_000)

  it('firefox: a joined page entry carries the pairing once', async () => {
    const built = await build(project({classicPair: true}), 'firefox')
    const options = built.read('options/index.js')

    expect(options.split(`var MARK = "${PAIRING_MARK}"`)).toHaveLength(2)
    expect(built.read('action/index.js')).not.toContain(PAIRING_MARK)
  }, 180_000)
})
