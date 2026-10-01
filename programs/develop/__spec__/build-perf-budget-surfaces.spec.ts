import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {categorizeAsset} from '../plugin-perf-budgets/categorize'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'h6FO1AAAAABJRU5ErkJggg==',
  'base64'
)

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function page(title: string, script: string, stylesheet?: string) {
  const link = stylesheet
    ? `<link rel="stylesheet" href="${stylesheet}">`
    : ''

  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${title}</title>${link}</head>` +
    `<body><h1>${title}</h1><script src="${script}"></script></body></html>`
  )
}

function project() {
  const root = fs.mkdtempSync(path.join(__dirname, '.tmp-perf-surfaces-'))
  roots.push(root)

  const files: Record<string, Buffer | string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'perf-surfaces',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'perf-surfaces',
      version: '1.0.0',
      icons: {16: 'images/icon-16.png'},
      action: {default_popup: 'action/index.html'},
      background: {service_worker: 'background.js'},
      chrome_url_overrides: {newtab: 'newtab/index.html'},
      devtools_page: 'devtools/index.html',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}],
      permissions: ['scripting'],
      host_permissions: ['<all_urls>']
    }),
    'images/icon-16.png': PNG,
    'background.js':
      "chrome.action.onClicked.addListener((tab) => chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/script-one.js']}))\n",
    'content/scripts.js': "document.title = 'content'\n",
    'scripts/script-one.js': "document.title = 'injected'\n",
    'lib/common.js':
      "export const banner = (name) => name + ' ' + 'x'.repeat(2048)\n",
    'action/index.html': page('Action', './scripts.js'),
    'action/scripts.js':
      "import React from 'react'\nimport {banner} from '../lib/common.js'\ndocument.body.append(banner(React.version))\n",
    'newtab/index.html': page('New Tab', './scripts.js', './styles.css'),
    'newtab/styles.css': 'body { color: rebeccapurple; }\n',
    'newtab/scripts.js':
      "import React from 'react'\nimport {banner} from '../lib/common.js'\ndocument.body.append(banner(React.version))\n",
    'devtools/index.html': page('Devtools', './scripts.js'),
    'devtools/scripts.js':
      "chrome.devtools.panels.create('Example', '', 'panel/index.html')\n",
    'panel/index.html': page('Panel', './scripts.js', './styles.css'),
    'panel/styles.css': 'body { color: teal; }\n',
    'panel/scripts.js': "document.body.append('panel')\n",
    'pages/main.html': page('Main', './main.js', '../public/css/file.css'),
    'pages/main.js': "document.body.append('main')\n",
    'public/css/file.css': 'h1 { color: tomato; }\n'
  }

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
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

function listCodeAssets(dir: string, base = dir): string[] {
  const found: string[] = []

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const abs = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      found.push(...listCodeAssets(abs, base))
      continue
    }

    if (/\.(js|css|wasm)$/i.test(entry.name)) {
      found.push(path.relative(base, abs).split(path.sep).join('/'))
    }
  }

  return found.sort()
}

describe('perf budget surfaces of a real build', () => {
  it('budgets every code asset the build emits', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const assets = listCodeAssets(path.join(root, 'dist', 'chrome'))
    const byCategory: Record<string, string[]> = {}

    for (const asset of assets) {
      const category = categorizeAsset(asset)
      byCategory[category] = [...(byCategory[category] || []), asset]
    }

    expect(byCategory.ignored).toBeUndefined()

    expect(byCategory.page).toEqual(
      expect.arrayContaining([
        'chrome_url_overrides/newtab.js',
        'chrome_url_overrides/newtab.css',
        'panel/index.js',
        'panel/index.css',
        'pages/main.js',
        'css/file.css'
      ])
    )

    expect(byCategory['content-script']).toEqual(
      expect.arrayContaining([
        'content_scripts/content-0.js',
        'scripts/script-one.js'
      ])
    )

    expect(byCategory['service-worker']).toEqual([
      'background/service_worker.js'
    ])

    expect(byCategory.shared).toEqual(
      expect.arrayContaining(['shared/framework.js', 'shared/commons.js'])
    )
  }, 120_000)
})
