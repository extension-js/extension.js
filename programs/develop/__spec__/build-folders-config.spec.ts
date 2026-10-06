import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import type {FileConfig} from '../types'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  files: Record<string, string | Buffer>,
  manifest: Record<string, unknown> = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folders-build-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'folders', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'folders',
      version: '1.0.0',
      permissions: ['scripting', 'activeTab'],
      background: {service_worker: 'background.js'},
      ...manifest
    })
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(
  root: string,
  mode: 'production' | 'development' = 'production'
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

const TYPED = [
  "const labelForThePage: string = 'TYPED_MARK'",
  'function paintTheLabel(textToPaint: string): void {',
  '  document.title = textToPaint',
  '}',
  'paintTheLabel(labelForThePage)',
  ''
].join('\n')
const CLASSIC =
  "var classicLabel = 'CLASSIC_MARK'\ndocument.title = classicLabel\n"

function inject(...files: string[]) {
  const calls = files.map(
    (file) =>
      `  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['${file}']})`
  )

  return [
    'chrome.action.onClicked.addListener((tab) => {',
    ...calls,
    '})',
    ''
  ].join('\n')
}

describe('the folders config in a build', () => {
  it('compiles a script named in code from a turned-off scripts/ like one in a plain folder', async () => {
    const root = project({
      'background.js': inject(
        'scripts/typed.js',
        'injected/typed.js',
        'scripts/classic.js',
        'injected/classic.js'
      ),
      'scripts/typed.ts': `import './typed.css'\n${TYPED}`,
      'injected/typed.ts': `import './typed.css'\n${TYPED}`,
      'scripts/typed.css': '.typed-mark { color: red }\n',
      'injected/typed.css': '.typed-mark { color: red }\n',
      'scripts/classic.js': CLASSIC,
      'injected/classic.js': CLASSIC,
      'extension.config.js': 'module.exports = {folders: {scripts: false}}\n'
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const emitted = (rel: string) =>
      fs.readFileSync(path.join(root, 'dist', 'chrome', rel), 'utf8')
    const typed = emitted('scripts/typed.js')

    expect(typed).toContain('TYPED_MARK')
    expect(typed).not.toContain(': string')
    expect(typed).not.toContain(': void')
    expect(typed).not.toContain('__EXTENSIONJS')
    expect(typed).toBe(emitted('injected/typed.js'))
    // Its stylesheet ships as a file too, not inlined as a content script's.
    expect(emitted('scripts/typed.css')).toBe(emitted('injected/typed.css'))
    expect(emitted('scripts/classic.js')).toBe(emitted('injected/classic.js'))
  }, 120_000)

  // The same extension twice: scripts/ at the root, and moved under src/.
  function twins() {
    const files = (folder: string) => ({
      'background.js': inject('scripts/typed.js'),
      [`${folder}/typed.ts`]: `import './typed.css'\n${TYPED}`,
      [`${folder}/typed.css`]: '.typed-mark { color: red }\n'
    })

    return {
      atRoot: project(files('scripts')),
      moved: project({
        ...files('src/scripts'),
        'extension.config.js':
          "module.exports = {folders: {scripts: 'src/scripts'}}\n"
      })
    }
  }

  function emittedFiles(root: string) {
    const dist = path.join(root, 'dist', 'chrome')

    return (fs.readdirSync(dist, {recursive: true}) as string[])
      .filter((rel) => fs.statSync(path.join(dist, rel)).isFile())
      .map((rel) => rel.split(path.sep).join('/'))
      .sort()
  }

  const script = (root: string) =>
    fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'scripts', 'typed.js'),
      'utf8'
    )

  it('builds a moved scripts/ exactly like the one at the root', async () => {
    const {atRoot, moved} = twins()

    expect((await build(atRoot)).errors_count).toBe(0)
    expect((await build(moved)).errors_count).toBe(0)

    expect(emittedFiles(moved)).toEqual(emittedFiles(atRoot))
    expect(script(atRoot)).toContain('__EXTENSIONJS_registerCleanup')
    expect(script(atRoot)).toContain('.typed-mark')

    // Module ids are a hash of the source path, the one thing that moved,
    // and they can be a single digit.
    const withoutModuleIds = (text: string) => text.replace(/\d+/g, '#')
    expect(withoutModuleIds(script(moved))).toBe(
      withoutModuleIds(script(atRoot))
    )
  }, 120_000)

  it('gives a moved scripts/ the reinjection scaffolding in development', async () => {
    const {atRoot, moved} = twins()

    expect((await build(atRoot, 'development')).errors_count).toBe(0)
    expect((await build(moved, 'development')).errors_count).toBe(0)

    expect(emittedFiles(moved)).toEqual(emittedFiles(atRoot))

    // The registry, the DOM markers and the key a new bundle replaces by.
    for (const marker of [
      /__EXTENSIONJS_BUNDLE_KEY\s*=\s*"scripts\/typed\.ts"/,
      /__EXTENSIONJS_REINJECT_KEY\s*=\s*"scripts\/typed\.ts"/,
      /data-extjs-reinject-key/,
      /__EXTENSIONJS_registerCleanup/
    ]) {
      expect(script(atRoot)).toMatch(marker)
      expect(script(moved)).toMatch(marker)
    }
  }, 120_000)

  it('builds a moved public/ and pages/ exactly like the ones at the root', async () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
    // Every way an extension names a file the public folder hosts.
    const manifest = {
      permissions: ['scripting', 'activeTab', 'declarativeNetRequest'],
      icons: {16: '/icon.png'},
      action: {default_popup: 'popup.html', default_icon: '/icon.png'},
      options_page: '/options.html',
      web_accessible_resources: [
        {
          resources: ['/war.png', 'war2.png', '/img/*.png'],
          matches: ['<all_urls>']
        }
      ],
      declarative_net_request: {
        rule_resources: [
          {id: 'r', enabled: true, path: 'rules.json'},
          {id: 's', enabled: true, path: '/rules2.json'}
        ]
      }
    }
    const files = (hosted: string, pages: string) => ({
      'background.js': [
        'chrome.action.onClicked.addListener((tab) => {',
        "  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['injected.js']})",
        "  chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ['plain.css']})",
        "  fetch(chrome.runtime.getURL('data.json'))",
        "  fetch('/data2.json')",
        '})',
        ''
      ].join('\n'),
      'popup.html':
        '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"><link rel="stylesheet" href="/plain.css"><link rel="icon" href="/icon.png"></head><body><img src="/logo.png"><iframe src="./frame.html"></iframe><script src="/vendor.js"></script><script src="./popup.js"></script></body></html>\n',
      // A page reached only through another page takes its own code path.
      'frame.html':
        '<!doctype html><html><head><link rel="stylesheet" href="/plain.css"></head><body>FRAME<img src="/logo.png"><script src="/vendor.js"></script></body></html>\n',
      'popup.css': 'body { background: url(in.png) }\n',
      'popup.js': 'console.log("popup")\n',
      [`${hosted}/icon.png`]: PNG,
      [`${hosted}/logo.png`]: PNG,
      [`${hosted}/war.png`]: PNG,
      [`${hosted}/war2.png`]: PNG,
      [`${hosted}/img/in.png`]: PNG,
      [`${hosted}/in.png`]: PNG,
      [`${hosted}/vendor.js`]: 'window.vendor = 1\n',
      [`${hosted}/injected.js`]: 'document.title = "INJECTED"\n',
      [`${hosted}/plain.css`]: 'p { color: blue }\n',
      [`${hosted}/data.json`]: '{"a":1}\n',
      [`${hosted}/data2.json`]: '{"a":2}\n',
      [`${hosted}/rules.json`]: '[]\n',
      [`${hosted}/rules2.json`]: '[]\n',
      [`${hosted}/options.html`]:
        '<!doctype html><html><body>OPTIONS<img src="/logo.png"></body></html>\n',
      [`${pages}/extra.html`]:
        '<!doctype html><html><head><link rel="stylesheet" href="./extra.css"></head><body>EXTRA<img src="/logo.png"><script src="./extra.js"></script></body></html>\n',
      [`${pages}/extra.css`]: 'h1 { color: green }\n',
      [`${pages}/extra.js`]: 'console.log("extra")\n'
    })

    const atRoot = project(files('public', 'pages'), manifest)
    const moved = project(
      {
        ...files('src/assets', 'src/pages'),
        'extension.config.js':
          "module.exports = {folders: {public: 'src/assets', pages: 'src/pages'}}\n"
      },
      manifest
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const fromRoot = await build(atRoot)
      const fromMoved = await build(moved)

      // A stylesheet naming a hosted file without the leading slash is the
      // one warning both builds owe, and the only one either may print.
      const warnings = (summary: {warnings?: string[]}) =>
        (summary.warnings || []).map((line) => line.split('\n')[0])

      expect(fromRoot.errors_count).toBe(0)
      expect(fromMoved.errors_count).toBe(0)
      expect(warnings(fromRoot)).toHaveLength(1)
      expect(warnings(fromRoot)[0]).toContain('"in.png" was not found on disk')
      expect(warnings(fromMoved)).toEqual(warnings(fromRoot))

      expect(emittedFiles(atRoot)).toContain('pages/extra.html')
      expect(emittedFiles(atRoot)).toContain('img/in.png')
      expect(emittedFiles(moved)).toEqual(emittedFiles(atRoot))

      // Module ids are a hash of the source path, the one thing that moved.
      const emitted = (root: string, rel: string) =>
        fs
          .readFileSync(path.join(root, 'dist', 'chrome', rel))
          .toString('latin1')
          .replace(/\d+/g, '#')

      for (const rel of emittedFiles(atRoot)) {
        expect(emitted(moved, rel), rel).toBe(emitted(atRoot, rel))
      }

      // Development names modules by source path, so only the shape compares.
      expect(warnings(await build(moved, 'development'))).toEqual(
        warnings(await build(atRoot, 'development'))
      )

      expect(emittedFiles(moved)).toEqual(emittedFiles(atRoot))
    } finally {
      warn.mockRestore()
    }
  }, 120_000)

  const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
  const publicOff = 'module.exports = {folders: {public: false}}\n'

  it('fails a build whose manifest names files in a turned-off public/', async () => {
    const root = project(
      {
        'background.js': 'console.log("worker")\n',
        'public/icon.png': PIXEL,
        'public/war.png': PIXEL,
        'public/rules.json': '[]\n',
        'public/rules2.json': '[]\n',
        'extension.config.js': publicOff
      },
      {
        permissions: ['declarativeNetRequest'],
        icons: {16: '/icon.png'},
        web_accessible_resources: [
          {resources: ['war.png'], matches: ['<all_urls>']}
        ],
        declarative_net_request: {
          rule_resources: [
            {id: 'r', enabled: true, path: 'rules.json'},
            {id: 's', enabled: true, path: '/rules2.json'}
          ]
        }
      }
    )
    const printed: string[] = []

    const capture = (...args: unknown[]) => {
      printed.push(args.map(String).join(' '))
    }

    const error = vi.spyOn(console, 'error').mockImplementation(capture)
    const log = vi.spyOn(console, 'log').mockImplementation(capture)

    try {
      await expect(build(root)).rejects.toThrow('Build failed with errors')
    } finally {
      error.mockRestore()
      log.mockRestore()
    }

    // eslint-disable-next-line no-control-regex
    const text = printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')

    expect(text).toContain('manifest.json names files that the build did not')

    for (const file of [
      'icon.png',
      'war.png',
      'rules2.json',
      'declarative_net_request/r.json'
    ]) {
      expect(text).toContain(`- ${file}`)
    }

    expect(text).toContain('folders.public is false')
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  }, 120_000)

  it('warns for a page and a stylesheet that reach into a turned-off public/', async () => {
    const root = project(
      {
        'background.js': 'console.log("worker")\n',
        'popup.html':
          '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head><body><img src="/logo.png"><script src="./popup.js"></script></body></html>\n',
        'popup.css': 'body { background: url(/bg.png) }\n',
        'popup.js': 'console.log("popup")\n',
        'public/logo.png': PIXEL,
        'public/bg.png': PIXEL,
        'extension.config.js': publicOff
      },
      {action: {default_popup: 'popup.html'}}
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const summary = (await build(root)) as {
        errors_count: number
        warnings?: string[]
      }
      const off = (summary.warnings || []).filter((line) =>
        line.includes('folders.public is false')
      )

      expect(summary.errors_count).toBe(0)
      expect(off).toHaveLength(2)
      expect(off.join('\n')).toContain('action/index.html references /logo.png')
      expect(off.join('\n')).toContain('action/index.css references /bg.png')
    } finally {
      warn.mockRestore()
    }

    expect(fs.existsSync(path.join(root, 'dist', 'chrome', 'logo.png'))).toBe(
      false
    )
  }, 120_000)

  it('emits every scripts/ and pages/ file but the Node helper, and says nothing about them', async () => {
    const root = project({
      'background.js': [
        'chrome.action.onClicked.addListener((tab) => {',
        "  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['scripts/x.js']})",
        "  chrome.tabs.create({url: chrome.runtime.getURL('pages/extra.html')})",
        '})',
        ''
      ].join('\n'),
      'scripts/x.js': "document.title = 'NAMED_SCRIPT_MARK'\n",
      'scripts/helper.js': "window.helperMark = 'PLAIN_HELPER_MARK'\n",
      'scripts/bump.js':
        "const fs = require('fs')\nfs.writeFileSync('out.txt', 'NODE_HELPER_MARK')\n",
      'pages/extra.html':
        '<!doctype html><html><body>EXTRA_PAGE_MARK</body></html>\n',
      'pages/orphan.html':
        '<!doctype html><html><body>ORPHAN_PAGE_MARK</body></html>\n'
    })
    const printed: string[] = []

    const capture = (...args: unknown[]) => {
      printed.push(args.map(String).join(' '))
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(capture)
    const log = vi.spyOn(console, 'log').mockImplementation(capture)
    let summary: {errors_count: number; warnings?: string[]}

    try {
      summary = await build(root)
    } finally {
      warn.mockRestore()
      log.mockRestore()
    }

    expect(summary.errors_count).toBe(0)
    expect(summary.warnings || []).toEqual([])
    // eslint-disable-next-line no-control-regex
    const text = printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(text).not.toContain('scripts/')
    expect(text).not.toContain('pages/')
    expect(text).not.toContain('Dropped')

    const emitted = emittedFiles(root)
    expect(emitted).toContain('scripts/x.js')
    expect(emitted).toContain('scripts/helper.js')
    expect(emitted).not.toContain('scripts/bump.js')
    expect(emitted).toContain('pages/extra.html')
    expect(emitted).toContain('pages/orphan.html')

    const read = (rel: string) =>
      fs.readFileSync(path.join(root, 'dist', 'chrome', rel), 'utf8')
    expect(read('scripts/x.js')).toContain('NAMED_SCRIPT_MARK')
    expect(read('scripts/helper.js')).toContain('PLAIN_HELPER_MARK')
    expect(read('pages/extra.html')).toContain('EXTRA_PAGE_MARK')
    expect(read('pages/orphan.html')).toContain('ORPHAN_PAGE_MARK')
  }, 120_000)

  it('reads folders from the command it runs, not from another one', async () => {
    const files = {
      'background.js': 'console.log("worker")\n',
      'pages/extra.html':
        '<!doctype html><html><body>EXTRA_PAGE</body></html>\n'
    }
    const page = (root: string) =>
      path.join(root, 'dist', 'chrome', 'pages', 'extra.html')

    // Typed, so the typecheck gate fails once the type drops the key.
    // No `browser` either: a command block names only what it overrides.
    const folders = {pages: false} as const
    const forBuild: FileConfig = {commands: {build: {folders}}}
    const forDev: FileConfig = {commands: {dev: {folders}}}
    const forServing: FileConfig = {
      commands: {start: {folders}, preview: {folders}}
    }
    expect(Object.keys(forServing.commands || {})).toEqual(['start', 'preview'])
    const off = project({
      ...files,
      'extension.config.js': `module.exports = ${JSON.stringify(forBuild)}\n`
    })
    expect((await build(off)).errors_count).toBe(0)
    expect(fs.existsSync(page(off))).toBe(false)

    const other = project({
      ...files,
      'extension.config.js': `module.exports = ${JSON.stringify(forDev)}\n`
    })
    expect((await build(other)).errors_count).toBe(0)
    expect(fs.readFileSync(page(other), 'utf8')).toContain('EXTRA_PAGE')
  }, 120_000)
})
