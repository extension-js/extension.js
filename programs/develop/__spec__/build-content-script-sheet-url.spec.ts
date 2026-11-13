import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  CHROMIUM_EXTENSION_ROOT,
  GECKO_EXTENSION_ROOT
} from '../plugin-web-extension/feature-scripts/scripts-lib/injected-sheet-urls'

// Chromium resolves a url() in a sheet it injects against the visited page,
// so the sheet a declared content script ships names its file by extension.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-sheet-url-'))
  roots.push(root)

  const files: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'sheet-url',
      version: '0.0.0'
    }),
    'media/pic.bin': Buffer.alloc(40_000),
    'styles/hook.module.css':
      '.probe { color: rgb(1, 2, 3); background-image: url(../media/pic.bin); }\r\n',
    'styles/listed.css':
      '.listed { color: rgb(4, 5, 6); background-image: url("../media/pic.bin"); }\n',
    'styles/plain.module.css': '.plain { color: rgb(7, 8, 9); }\n',
    'content/isolated.js':
      'import hook from "../styles/hook.module.css"\n' +
      'globalThis.__ISOLATED_CLASS__ = hook.probe\n',
    'content/main.js':
      'import hook from "../styles/hook.module.css"\n' +
      'globalThis.__MAIN_CLASS__ = hook.probe\n',
    'content/listed.js': 'globalThis.__LISTED__ = 1\n',
    'content/plain.js':
      'import plain from "../styles/plain.module.css"\n' +
      'globalThis.__PLAIN_CLASS__ = plain.plain\n',
    'action/index.html':
      '<!doctype html><html><head><link rel="stylesheet" href="./index.css">' +
      '</head><body></body></html>\n',
    'action/index.css': '.page { background-image: url(../media/pic.bin); }\n',
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'sheet-url',
      version: '1.0.0',
      action: {default_popup: 'action/index.html'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/isolated.js']},
        {
          matches: ['https://example.com/*'],
          js: ['content/main.js'],
          world: 'MAIN'
        },
        {
          matches: ['https://example.com/*'],
          js: ['content/listed.js'],
          css: ['styles/listed.css']
        },
        {matches: ['https://example.com/*'], js: ['content/plain.js']}
      ],
      browser_specific_settings: {gecko: {id: 'sheet-url@example.com'}}
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
    has: (file: string) => fs.existsSync(at(file)),
    manifest: () => JSON.parse(fs.readFileSync(at('manifest.json'), 'utf8'))
  }
}

function urlTargets(css: string): string[] {
  return [...css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map(
    (match) => match[1]
  )
}

const SHEETS = [
  ['an isolated world CSS module', 'content_scripts/content-0.css'],
  ['a MAIN world CSS module', 'content_scripts/content-1.css'],
  ['a sheet in the manifest css list', 'content_scripts/content-2.css']
] as const

describe('the sheet of a declared content script on Chromium', () => {
  it.each(SHEETS)(
    'names the file %s reaches for from the extension',
    async (_label, sheet) => {
      const built = await build('chrome')
      const manifest = built.manifest()
      const targets = urlTargets(built.read(sheet))

      expect(targets).toHaveLength(1)
      expect(targets[0].startsWith(CHROMIUM_EXTENSION_ROOT)).toBe(true)

      // The file ships, and a page the script runs on is let to load it.
      const file = targets[0].slice(CHROMIUM_EXTENSION_ROOT.length)

      expect(file).toMatch(/^assets\/pic\.[0-9a-f]+\.bin$/)
      expect(built.has(file)).toBe(true)
      expect(
        manifest.web_accessible_resources.some(
          (group: {resources: string[]; matches: string[]}) =>
            group.resources.includes(file) &&
            group.matches.includes('https://example.com/*')
        )
      ).toBe(true)
    },
    180_000
  )

  it('leaves a sheet with no url() and a page sheet as the bundler wrote them', async () => {
    const built = await build('chrome')

    expect(built.read('content_scripts/content-3.css')).toMatch(
      /^\.[\w-]+\{color:#070809\}\s*$/
    )

    const page = urlTargets(built.read('action/index.css'))

    expect(page).toHaveLength(1)
    expect(page[0]).toMatch(/^\/assets\/pic\.[0-9a-f]+\.bin$/)
  }, 180_000)
})

// Firefox resolves an injected sheet against the extension, and a sheet a
// script fetches into a style element against the page, so both get the id.
describe('the sheet of a declared content script on Firefox', () => {
  it.each(SHEETS)(
    'names the file %s reaches for from the extension',
    async (_label, sheet) => {
      const built = await build('firefox')
      const targets = urlTargets(built.read(sheet))

      expect(targets).toHaveLength(1)
      expect(targets[0].startsWith(GECKO_EXTENSION_ROOT)).toBe(true)

      const file = targets[0].slice(GECKO_EXTENSION_ROOT.length)

      expect(file).toMatch(/^assets\/pic\.[0-9a-f]+\.bin$/)
      expect(built.has(file)).toBe(true)
    },
    180_000
  )

  it('leaves a sheet with no url() and a page sheet as the bundler wrote them', async () => {
    const built = await build('firefox')

    expect(built.read('content_scripts/content-3.css')).toMatch(
      /^\.[\w-]+\{color:#070809\}\s*$/
    )

    const page = urlTargets(built.read('action/index.css'))

    expect(page).toHaveLength(1)
    expect(page[0]).toMatch(/^\/assets\/pic\.[0-9a-f]+\.bin$/)
  }, 180_000)
})
