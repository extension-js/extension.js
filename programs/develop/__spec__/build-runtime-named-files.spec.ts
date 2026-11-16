import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  files: Record<string, string>,
  manifest: Record<string, unknown> = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-named-files-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'named-files',
      version: '1.0.0',
      action: {},
      permissions: ['scripting'],
      background: {service_worker: 'background/index.js'},
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

async function build(root: string, browser: 'chrome' | 'firefox' = 'chrome') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

const LOAD = [
  'async function load() {',
  '  const response = await fetch(CONFIG.local)',
  '  console.log(await response.text())',
  '}',
  'chrome.runtime.onInstalled.addListener(load)',
  ''
].join('\n')

describe('a file the worker fetches through a table of paths', () => {
  it('ships it when the table holds the one path', async () => {
    const root = project({
      'background/index.js': `const CONFIG = {local: '../config/sites.config'}\n${LOAD}`,
      'config/sites.config': 'example.com\n'
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(
      fs.existsSync(path.join(root, 'dist/chrome/config/sites.config'))
    ).toBe(true)
  }, 120_000)

  // The sibling keeps the minifier from writing the path into the fetch
  // call, which is the one place the build once looked for it.
  it.each([
    'chrome',
    'firefox'
  ] as const)('ships it when a remote address sits beside the path, on %s', async (browser) => {
    const root = project({
      'background/index.js': [
        "const CONFIG_URL_BASE = 'https://example.com/config'",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text
        "const CONFIG = {remote: `${CONFIG_URL_BASE}/sites.config`, local: '../config/sites.config'}",
        LOAD
      ].join('\n'),
      'config/sites.config': 'example.com\n'
    })

    const summary = await build(root, browser)
    expect(summary.errors_count).toBe(0)
    expect(
      fs.readFileSync(
        path.join(root, 'dist', browser, 'config/sites.config'),
        'utf8'
      )
    ).toBe('example.com\n')
  }, 120_000)
})

describe('a worker built by another bundler', () => {
  it('ships what it reads, injects and opens after a comment-stripping pattern', async () => {
    const root = project({
      'background/index.js': [
        '(function () {',
        '    "use strict";',
        '    const comments = /\\/\\*[\\s\\S]*?\\*\\//g;',
        '    function strip(text) { return text.replace(comments, ""); }',
        '    const URLS = {',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text
        '        sites: {remote: `${self.origin}/sites.config`, local: "../config/sites.config"},',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text
        '        colors: {remote: `${self.origin}/colors.drconf`, local: "../config/colors.drconf"}',
        '    };',
        '    class Icons {',
        '        static PATHS = {',
        '            dark: {19: "../icons/dark_19.png"},',
        '            light: {19: "../icons/light_19.png"}',
        '        };',
        '        static set(light) {',
        '            chrome.action.setIcon({path: light ? Icons.PATHS.light : Icons.PATHS.dark});',
        '        }',
        '    }',
        '    async function read({url}) { return strip(await (await fetch(url)).text()); }',
        '    chrome.runtime.onInstalled.addListener(async () => {',
        '        await read({url: URLS.sites.local});',
        '        await read({url: URLS.colors.local});',
        '        Icons.set(true);',
        '        chrome.tabs.query({}, (tabs) => tabs.forEach((tab) =>',
        '            chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["/inject/index.js"]})));',
        '        chrome.tabs.create({url: chrome.runtime.getURL("/ui/options/index.html")});',
        '    });',
        '})();',
        ''
      ].join('\n'),
      'config/sites.config': 'example.com\n',
      'config/colors.drconf': 'dark\n',
      'icons/dark_19.png': 'png',
      'icons/light_19.png': 'png',
      'inject/index.js': '(function () { window.__injected = true; })();\n',
      'ui/options/index.html':
        '<!doctype html><html><head><link rel="stylesheet" href="style.css" /><script src="index.js" defer></script></head><body></body></html>',
      'ui/options/index.js':
        '(function () { const img = document.createElement("img"); img.src = "../assets/images/thumb.svg"; document.body.append(img); })();\n',
      'ui/options/style.css':
        '@font-face { font-family: "Sample"; src: url("../assets/fonts/sample.ttf"); }\n',
      'ui/assets/fonts/sample.ttf': 'font',
      'ui/assets/images/thumb.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>'
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings || []).toEqual([])

    for (const rel of [
      'config/sites.config',
      'config/colors.drconf',
      'icons/dark_19.png',
      'icons/light_19.png',
      'inject/index.js',
      'ui/options/index.html',
      'ui/options/index.js',
      'ui/options/style.css',
      'ui/assets/fonts/sample.ttf',
      'ui/assets/images/thumb.svg'
    ]) {
      expect(fs.existsSync(path.join(root, 'dist/chrome', rel)), rel).toBe(true)
    }
  }, 120_000)
})

function outputFiles(root: string, browser: string): string[] {
  const out = path.join(root, 'dist', browser)
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, {withFileTypes: true})
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : [path.relative(out, path.join(dir, entry.name))]
      )

  return walk(out)
    .map((file) => file.split(path.sep).join('/'))
    .sort()
}

describe('a stylesheet a script injects by file', () => {
  const SHEETS = {
    'styles/inject.css': [
      '@import "base.css";',
      '@font-face { font-family: "Injected"; src: url("../fonts/a.ttf"); }',
      'body { background-image: url(img/bg.png); }',
      ''
    ].join('\n'),
    'styles/base.css': '.base { background: url("img/base.png"); }\n',
    'styles/registered.css': 'p { background: url(img/registered.png); }\n',
    'styles/img/bg.png': 'png',
    'styles/img/base.png': 'png',
    'styles/img/registered.png': 'png',
    'fonts/a.ttf': 'font',
    'fonts/OFL.txt': 'license'
  }
  // The license is named by nothing and ships because the font does.
  const LOADED = [
    'fonts/OFL.txt',
    'fonts/a.ttf',
    'styles/base.css',
    'styles/img/base.png',
    'styles/img/bg.png',
    'styles/inject.css'
  ]

  it('ships the fonts and images the sheet loads, on chrome', async () => {
    const root = project({
      ...SHEETS,
      'background/index.js': [
        'chrome.action.onClicked.addListener((tab) =>',
        '  chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ["styles/inject.css"]}))',
        'chrome.runtime.onInstalled.addListener(() =>',
        '  chrome.scripting.registerContentScripts([',
        '    {id: "sheet", matches: ["https://example.com/*"], css: ["styles/registered.css"]}',
        '  ]))',
        ''
      ].join('\n')
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(outputFiles(root, 'chrome')).toEqual(
      expect.arrayContaining([
        ...LOADED,
        'styles/registered.css',
        'styles/img/registered.png'
      ])
    )

    // The visited page fetches the font and the images, so it may: the
    // group a scripts/ file gets, with the same notice.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'dist/chrome/manifest.json'), 'utf8')
    )

    expect(manifest.web_accessible_resources).toEqual([
      {
        resources: [
          'fonts/a.ttf',
          'styles/img/base.png',
          'styles/img/bg.png',
          'styles/img/registered.png'
        ],
        matches: ['<all_urls>']
      }
    ])

    expect(summary.warnings_count).toBe(2)

    // Chromium reads an injected sheet's paths against the visited page, so
    // each one names the extension. It drops an @import, so the imported
    // rules are written in its place.
    const address = 'chrome-extension://__MSG_@@extension_id__/'

    expect(
      fs.readFileSync(path.join(root, 'dist/chrome/styles/inject.css'), 'utf8')
    ).toBe(
      [
        `.base { background: url("${address}styles/img/base.png"); }`,
        `@font-face { font-family: "Injected"; src: url("${address}fonts/a.ttf"); }`,
        `body { background-image: url("${address}styles/img/bg.png"); }`,
        ''
      ].join('\n')
    )

    expect(
      fs.readFileSync(
        path.join(root, 'dist/chrome/styles/registered.css'),
        'utf8'
      )
    ).toBe(`p { background: url("${address}styles/img/registered.png"); }\n`)

    // The imported file itself still ships as written.
    expect(
      fs.readFileSync(path.join(root, 'dist/chrome/styles/base.css'), 'utf8')
    ).toBe(SHEETS['styles/base.css'])
  }, 120_000)

  const INJECT = [
    'chrome.action.onClicked.addListener((tab) =>',
    '  chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ["styles/inject.css"]}))',
    ''
  ].join('\n')

  it('writes each import under its condition, from its own folder, on chrome', async () => {
    const root = project({
      'background/index.js': INJECT,
      'styles/inject.css': [
        '@charset "utf-8";',
        '@import "base.css";',
        '@import url("print.css") print;',
        '@import "low.css" layer(low) supports(display: grid) screen;',
        '@import "https://fonts.example/far.css";',
        '@import "gone.css";',
        '.own { color: red; }',
        ''
      ].join('\n'),
      'styles/base.css':
        '@import "deep/deep.css";\n@import "inject.css";\n.base { color: blue; }\n',
      'styles/deep/deep.css': '.deep { background: url("img/deep.png"); }\n',
      'styles/deep/img/deep.png': 'png',
      'styles/print.css': '.print { color: black; }\n',
      'styles/low.css': '.low { color: gray; }\n'
    })

    const summary = await build(root)
    const address = 'chrome-extension://__MSG_@@extension_id__/'

    expect(summary.errors_count).toBe(0)
    expect(
      fs.readFileSync(path.join(root, 'dist/chrome/styles/inject.css'), 'utf8')
    ).toBe(
      [
        '@charset "utf-8";',
        `.deep { background: url("${address}styles/deep/img/deep.png"); }`,
        '',
        '.base { color: blue; }',
        '@media print {',
        '.print { color: black; }',
        '}',
        '@supports (display: grid) {',
        '@media screen {',
        '@layer low {',
        '.low { color: gray; }',
        '}',
        '}',
        '}',
        '@import "https://fonts.example/far.css";',
        '@import "gone.css";',
        '.own { color: red; }',
        ''
      ].join('\n')
    )

    // The page fetches the image the deepest sheet names, so it may.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, 'dist/chrome/manifest.json'), 'utf8')
      ).web_accessible_resources
    ).toEqual([
      {resources: ['styles/deep/img/deep.png'], matches: ['<all_urls>']}
    ])

    // One line for the exposed image, one per import that stays a rule
    // Chrome drops, each with its file and line.
    const kept = (summary.warnings || []).filter((text: string) =>
      text.includes('Chrome drops')
    )

    expect(kept).toHaveLength(2)
    expect(kept[0]).toContain("imports 'https://fonts.example/far.css'")
    expect(kept[0]).toContain('styles/inject.css:5')
    expect(kept[1]).toContain("imports 'gone.css'")
    expect(kept[1]).toContain('styles/inject.css:6')
    expect(summary.warnings_count).toBe(3)
  }, 120_000)

  it('keeps the imports of the sheet as written, on firefox', async () => {
    const sheet = '@import "base.css";\n.own { color: red; }\n'
    const root = project(
      {
        'background/index.js': INJECT,
        'styles/inject.css': sheet,
        'styles/base.css': '.base { color: blue; }\n'
      },
      {background: {scripts: ['background/index.js']}}
    )

    const summary = await build(root, 'firefox')

    expect(summary.errors_count).toBe(0)
    expect(
      (summary.warnings || []).filter((text: string) =>
        text.includes('styles/inject.css')
      )
    ).toEqual([])

    expect(
      fs.readFileSync(path.join(root, 'dist/firefox/styles/inject.css'), 'utf8')
    ).toBe(sheet)
  }, 120_000)

  it('leaves a public/ sheet byte for byte and names its first import, on chrome', async () => {
    const sheet = [
      '/* shipped as written */',
      '@import "base.css";',
      '@import "more.css";',
      '.own { background: url("img/own.png"); }',
      ''
    ].join('\n')
    const root = project({
      'background/index.js': INJECT,
      'public/styles/inject.css': sheet,
      'public/styles/base.css': '.base { color: blue; }\n',
      'public/styles/more.css': '.more { color: blue; }\n',
      'public/styles/img/own.png': 'png'
    })

    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(
      fs.readFileSync(path.join(root, 'dist/chrome/styles/inject.css'), 'utf8')
    ).toBe(sheet)

    const said = (summary.warnings || []).filter((text: string) =>
      text.includes('Chrome drops')
    )

    expect(said).toHaveLength(1)
    expect(said[0]).toContain("imports 'base.css'")
    expect(said[0]).toContain('public/styles/inject.css:2')

    // Chrome reads the image against the visited page, said once with the
    // first target and the spelling that names it from the extension.
    const targets = (summary.warnings || []).filter((text: string) =>
      text.includes('against the visited page')
    )

    expect(targets).toHaveLength(1)
    expect(targets[0]).toContain('url(img/own.png)')
    expect(targets[0]).toContain('public/styles/inject.css:4')
    expect(targets[0]).toContain(
      'url("chrome-extension://__MSG_@@extension_id__/styles/img/own.png")'
    )

    expect(summary.warnings_count).toBe(2)
  }, 120_000)

  it('says nothing of a public/ sheet on firefox, which reads beside the sheet', async () => {
    const sheet =
      '@import "base.css";\n.own { background: url("img/own.png"); }\n'
    const root = project(
      {
        'background/index.js': INJECT,
        'public/styles/inject.css': sheet,
        'public/styles/base.css': '.base { color: blue; }\n',
        'public/styles/img/own.png': 'png'
      },
      {background: {scripts: ['background/index.js']}}
    )

    const summary = await build(root, 'firefox')

    expect(summary.errors_count).toBe(0)
    expect(
      (summary.warnings || []).filter((text: string) =>
        text.includes('styles/inject.css')
      )
    ).toEqual([])

    expect(
      fs.readFileSync(path.join(root, 'dist/firefox/styles/inject.css'), 'utf8')
    ).toBe(sheet)
  }, 120_000)

  it('ships them for the tabs.insertCSS file form, on firefox', async () => {
    const root = project(
      {
        ...SHEETS,
        'background.js':
          'browser.browserAction.onClicked.addListener((tab) => browser.tabs.insertCSS(tab.id, {file: "/styles/inject.css"}))\n'
      },
      {
        manifest_version: 2,
        action: undefined,
        browser_action: {},
        permissions: ['activeTab'],
        background: {scripts: ['background.js']}
      }
    )

    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)
    expect(outputFiles(root, 'firefox')).toEqual(expect.arrayContaining(LOADED))

    // Firefox loads an image an injected sheet names without an entry, and
    // refuses its font without one, so only the font is listed.
    const listed: string[] =
      JSON.parse(
        fs.readFileSync(path.join(root, 'dist/firefox/manifest.json'), 'utf8')
      ).web_accessible_resources || []

    expect(listed).toEqual(['fonts/a.ttf'])

    // Firefox reads the paths from where the sheet sits, so it ships as written.
    expect(
      fs.readFileSync(path.join(root, 'dist/firefox/styles/inject.css'), 'utf8')
    ).toBe(SHEETS['styles/inject.css'])
  }, 120_000)
})

describe('a file a moved script names', () => {
  const FILES = {
    'data/fetched.json': '{}',
    'data/dotted.json': '{}',
    'data/rooted.json': '{}',
    'data/addressed.json': '{}',
    'data/listed.json': '{}',
    'data/absolute.json': '{}'
  }
  // The second property keeps the minifier from writing the listed path
  // into the call, the way a real table of paths survives a build.
  const SCRIPT = [
    'const api = globalThis.browser || globalThis.chrome',
    'const TABLE = {listed: "data/listed.json", other: "data/absolute.json"}',
    'const read = (name) => fetch(TABLE[name])',
    'api.runtime.onInstalled.addListener(async () => {',
    '  await fetch("data/fetched.json")',
    '  await fetch("./data/dotted.json")',
    '  await fetch("/data/rooted.json")',
    '  await fetch(api.runtime.getURL("data/addressed.json"))',
    '  await read(Date.now() % 2 ? "listed" : "other")',
    '})',
    ''
  ].join('\n')
  const data = (root: string, browser: string) =>
    outputFiles(root, browser).filter(
      (file) => file.endsWith('.json') && file !== 'manifest.json'
    )

  it('ships one copy per provable form beside a moved worker, on chrome', async () => {
    const root = project(
      {...FILES, 'background.js': SCRIPT},
      {background: {service_worker: 'background.js'}}
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(data(root, 'chrome')).toEqual([
      // A table proves no call, so its paths ship where both forms read.
      'background/data/absolute.json',
      'background/data/dotted.json',
      'background/data/fetched.json',
      'background/data/listed.json',
      'data/absolute.json',
      'data/addressed.json',
      'data/listed.json',
      'data/rooted.json'
    ])
  }, 120_000)

  it('ships every file once at the root for background scripts, on firefox', async () => {
    const root = project(
      {...FILES, 'background.js': SCRIPT},
      {background: {scripts: ['background.js']}}
    )

    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)
    expect(data(root, 'firefox')).toEqual([
      'data/absolute.json',
      'data/addressed.json',
      'data/dotted.json',
      'data/fetched.json',
      'data/listed.json',
      'data/rooted.json'
    ])
  }, 120_000)
})
