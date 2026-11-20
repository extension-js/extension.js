import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-kept-page-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'kept-page',
      version: '0.0.0'
    }),
    ...files
  }

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(
  root: string,
  mode: 'production' | 'development' = 'production',
  browser: 'chrome' | 'firefox' = 'chrome'
) {
  return buildProject(root, {
    browser,
    mode
  })
}

function dist(root: string, rel: string, browser = 'chrome') {
  return path.join(root, 'dist', browser, rel)
}

function read(root: string, rel: string, browser = 'chrome') {
  return fs.readFileSync(dist(root, rel, browser), 'utf8')
}

function manifestOf(root: string, browser = 'chrome') {
  return JSON.parse(read(root, 'manifest.json', browser)) as Record<string, any>
}

const POPUP_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"></head>' +
  '<body><p id="out">KEPT_PAGE</p><script src="index.js"></script></body></html>\n'

// The background only answers the page it knows by path, the way an
// extension written for an unpacked folder does.
const SENDER_CHECK =
  'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n' +
  "  if (!sender.url || !sender.url.endsWith('/ui/popup/index.html')) return\n" +
  "  sendResponse({data: 'settings'})\n" +
  '})\n'

const BASE_FILES = {
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'kept-page',
    version: '1.0.0',
    background: {service_worker: 'background/index.js'},
    action: {default_popup: 'ui/popup/index.html'}
  }),
  'background/index.js': SENDER_CHECK,
  'ui/popup/index.html': POPUP_PAGE,
  'ui/popup/index.js':
    'chrome.runtime.sendMessage({type: "get"}, (response) => {\n' +
    '  document.getElementById("out").textContent = String(response && response.data)\n' +
    '})\n'
}

describe('a page whose authored path a script holds as a string', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`opens at the authored path in ${mode}`, async () => {
      const root = project(BASE_FILES)
      await build(root, mode)

      expect(manifestOf(root).action.default_popup).toBe('ui/popup/index.html')

      const kept = read(root, 'ui/popup/index.html')

      expect(kept).toBe(read(root, 'action/index.html'))
      expect(kept).toContain('KEPT_PAGE')
      expect(kept).toContain('src="/action/index.js"')
      expect(fs.existsSync(dist(root, 'action/index.js'))).toBe(true)
      expect(fs.existsSync(dist(root, 'ui/popup/index.js'))).toBe(false)
    }, 180_000)
  }

  it('opens at the authored path on a Firefox build too', async () => {
    const root = project(BASE_FILES)
    await build(root, 'production', 'firefox')

    expect(manifestOf(root, 'firefox').action.default_popup).toBe(
      'ui/popup/index.html'
    )

    expect(fs.existsSync(dist(root, 'ui/popup/index.html', 'firefox'))).toBe(
      true
    )
  }, 180_000)

  it('keeps the canonical path when no script names the page', async () => {
    const root = project({
      ...BASE_FILES,
      'background/index.js':
        '// A comment that names /ui/popup/index.html keeps nothing.\n' +
        'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n' +
        "  sendResponse({data: 'settings'})\n" +
        '})\n'
    })
    await build(root)

    expect(manifestOf(root).action.default_popup).toBe('action/index.html')
    expect(fs.existsSync(dist(root, 'ui/popup/index.html'))).toBe(false)
  }, 180_000)

  it('keeps the canonical path for a longer path that ends the same way', async () => {
    const root = project({
      ...BASE_FILES,
      'background/index.js':
        "console.log('https://example.com/docs/ui/popup/index.html')\n"
    })
    await build(root)

    expect(manifestOf(root).action.default_popup).toBe('action/index.html')
  }, 180_000)

  it('points every key that shares the source at the one authored page', async () => {
    const root = project({
      ...BASE_FILES,
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'kept-page',
        version: '1.0.0',
        background: {service_worker: 'background/index.js'},
        action: {default_popup: 'ui/popup/index.html'},
        options_ui: {page: 'ui/popup/index.html'}
      }),
      'background/index.js':
        'const allowed = [chrome.runtime.getURL("/ui/popup/index.html")]\n' +
        'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n' +
        '  if (allowed.includes(sender.url)) sendResponse({data: "settings"})\n' +
        '})\n'
    })
    await build(root)

    const manifest = manifestOf(root)

    expect(manifest.action.default_popup).toBe('ui/popup/index.html')
    expect(manifest.options_ui.page).toBe('ui/popup/index.html')

    // One path serves one page, and the options page is the one that
    // carries what Chrome's embedded dialog needs.
    expect(read(root, 'ui/popup/index.html')).toBe(
      read(root, 'options/index.html')
    )
  }, 180_000)

  it('keeps only the page that is named when the manifest declares several', async () => {
    const root = project({
      ...BASE_FILES,
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'kept-page',
        version: '1.0.0',
        background: {service_worker: 'background/index.js'},
        action: {default_popup: 'ui/popup/index.html'},
        options_ui: {page: 'ui/options/index.html', open_in_tab: true},
        devtools_page: 'ui/devtools/index.html'
      }),
      'ui/options/index.html': POPUP_PAGE.replace('KEPT_PAGE', 'OPTIONS_PAGE'),
      'ui/options/index.js': 'console.log("options")\n',
      'ui/devtools/index.html': POPUP_PAGE.replace('KEPT_PAGE', 'DEVTOOLS'),
      'ui/devtools/index.js':
        'console.log(location.pathname === "/ui/devtools/index.html")\n'
    })
    await build(root)

    const manifest = manifestOf(root)

    expect(manifest.action.default_popup).toBe('ui/popup/index.html')
    expect(manifest.devtools_page).toBe('ui/devtools/index.html')
    expect(manifest.options_ui.page).toBe('options/index.html')
    expect(read(root, 'ui/devtools/index.html')).toContain('DEVTOOLS')
    expect(fs.existsSync(dist(root, 'ui/options/index.html'))).toBe(false)
  }, 180_000)

  it('ships a file the kept page fetches beside itself where the page now asks', async () => {
    const root = project({
      ...BASE_FILES,
      'ui/popup/index.js':
        BASE_FILES['ui/popup/index.js'] +
        'fetch("settings.json").then((response) => response.json())\n',
      'ui/popup/settings.json': '{"theme":"dark"}\n'
    })
    await build(root)

    expect(read(root, 'ui/popup/settings.json')).toBe('{"theme":"dark"}\n')
    expect(read(root, 'action/settings.json')).toBe('{"theme":"dark"}\n')
  }, 180_000)

  it('stays quiet about a relative src the kept page resolves as written', async () => {
    const files = {
      'package.json': JSON.stringify({
        private: true,
        type: 'module',
        name: 'kept-page',
        version: '0.0.0'
      }),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'kept-page',
        version: '1.0.0',
        permissions: ['sidePanel'],
        background: {service_worker: 'background.js'},
        side_panel: {default_path: 'panel.html'}
      }),
      'panel.html':
        '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
        '<script src="./panel.js"></script></body></html>\n',
      'panel.js':
        'const h = (tag, props) => Object.assign(document.createElement(tag), props)\n' +
        "document.body.append(h('img', {src: 'logo.png', alt: 'logo'}))\n",
      'public/logo.png': 'png'
    }
    const moved = (summary: {warnings?: string[]} | undefined) =>
      (summary?.warnings || []).filter((text) =>
        text.includes('sets a src or href')
      )

    const relocated = project({
      ...files,
      'background.js': 'console.log("background")\n'
    })

    expect(moved((await build(relocated)) as never)).toHaveLength(1)

    const kept = project({
      ...files,
      'background.js':
        'chrome.runtime.onMessage.addListener((message, sender) => {\n' +
        '  console.log(sender.url === chrome.runtime.getURL("panel.html"))\n' +
        '})\n'
    })

    expect(moved((await build(kept)) as never)).toEqual([])
    expect(manifestOf(kept).side_panel.default_path).toBe('panel.html')
  }, 180_000)

  it('says which page kept its path and which file names it', async () => {
    const root = project(BASE_FILES)
    const lines: string[] = []
    const log = console.log

    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }

    try {
      const {extensionBuild} = await import('../command-build')

      await extensionBuild(root, {
        browser: 'chrome',
        install: false,
        mode: 'production'
      } as never)
    } finally {
      console.log = log
    }

    const text = stripVTControlCharacters(lines.join('\n'))

    expect(text).toContain(
      'action.default_popup opens at ui/popup/index.html in the built manifest'
    )

    expect(text).toContain('background/index.js:2 holds that path as a string')
  }, 180_000)
})

describe('a pages/ folder page a script names through getURL', () => {
  const page = (script: string) =>
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    `<body><p>FOLDER_PAGE</p><script src="./${script}"></script></body></html>\n`

  const FILES = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'folder-page',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    'background.js':
      'console.log(\n' +
      '  chrome.runtime.getURL("pages/welcome/index.html"),\n' +
      '  chrome.runtime.getURL("pages/typed/index.html"),\n' +
      '  chrome.runtime.getURL("pages/deep/er/index.html"),\n' +
      '  chrome.runtime.getURL("pages/plain.html")\n' +
      ')\n',
    'pages/welcome/index.html': page('index.js'),
    'pages/welcome/index.js':
      "import {mark} from './mark.js'\ndocument.title = 'RAN_WELCOME ' + mark\n",
    'pages/welcome/mark.js': "export const mark = 'IMPORTED_MARK'\n",
    'pages/typed/index.html': page('index.ts'),
    'pages/typed/index.ts':
      "interface Mark {\n  value: string\n}\nconst mark: Mark = {value: 'RAN_TYPED'}\ndocument.title = mark.value\n",
    'pages/deep/er/index.html': page('index.js'),
    'pages/deep/er/index.js': "document.title = 'RAN_DEEP'\n",
    'pages/plain.html': page('plain.js'),
    'pages/plain.js': "document.title = 'RAN_PLAIN'\n"
  }

  for (const browser of ['chrome', 'firefox'] as const) {
    for (const mode of ['production', 'development'] as const) {
      it(`${browser} ${mode}: the authored path serves the compiled page and no raw copy ships`, async () => {
        const root = project(FILES)
        await build(root, mode, browser)

        const pairs = [
          ['pages/welcome/index.html', 'pages/welcome'],
          ['pages/typed/index.html', 'pages/typed'],
          ['pages/deep/er/index.html', 'pages/deep/er']
        ]

        for (const [authored, compiled] of pairs) {
          const served = read(root, authored, browser)

          expect(served, authored).toBe(read(root, `${compiled}.html`, browser))
          expect(served, authored).toContain(`src="/${compiled}.js"`)
          expect(served, authored).not.toContain('./index.')
        }

        // No source ships beside a served page, compiled or as written.
        for (const raw of [
          'pages/welcome/index.js',
          'pages/welcome/mark.js',
          'pages/typed/index.ts',
          'pages/typed/index.js',
          'pages/deep/er/index.js'
        ]) {
          expect(fs.existsSync(dist(root, raw, browser)), raw).toBe(false)
        }

        expect(read(root, 'pages/welcome.js', browser)).toContain(
          'IMPORTED_MARK'
        )

        expect(read(root, 'pages/typed.js', browser)).not.toContain('interface')
        expect(read(root, 'pages/plain.html', browser)).toContain(
          'src="/pages/plain.js"'
        )
      }, 180_000)
    }
  }
})
