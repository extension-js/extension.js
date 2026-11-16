import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
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
      background: {service_worker: 'background/index.js'}
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
