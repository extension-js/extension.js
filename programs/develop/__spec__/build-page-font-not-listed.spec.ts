import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

type Browser = 'chrome' | 'firefox'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const fontFace = (family: string, target: string) =>
  `@font-face { font-family: "${family}"; src: url("${target}") format("woff2"); }\n`

function project(manifestVersion: 2 | 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-font-'))
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'page-font',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: manifestVersion,
      name: 'page-font',
      version: '1.0.0',
      options_ui: {page: 'options.html'},
      background:
        manifestVersion === 3
          ? {service_worker: 'background.js', scripts: ['background.js']}
          : {scripts: ['background.js']},
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content/script.js'],
          css: ['content/declared.css']
        }
      ]
    }),
    'background.js':
      'chrome.tabs.create({url: chrome.runtime.getURL("views/extra.html")})\n',
    'content/script.js': 'document.documentElement.dataset.pageFont = "1"\n',
    'content/declared.css': fontFace('Declared', '/fonts/content.woff2'),
    // A page the manifest names, whose sheet reaches a font under public/.
    'options.html':
      '<!doctype html><html><head><link rel="stylesheet" href="css/page.css"></head><body></body></html>',
    'css/page.css': fontFace('PageOnly', '/fonts/page.woff2'),
    // A page only a script names ships as written, sheet and font beside it.
    'views/extra.html':
      '<!doctype html><html><head><link rel="stylesheet" href="../css/extra.css"></head><body></body></html>',
    'css/extra.css': fontFace('ExtraOnly', '../fonts/extra.woff2'),
    'fonts/extra.woff2': 'extra-font',
    'public/fonts/page.woff2': 'page-font',
    'public/fonts/content.woff2': 'content-font',
    'public/fonts/unused.ttf': 'unused-font'
  }

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, browser: Browser) {
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
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

// Every path the built manifest lets a page fetch, whichever shape it has.
function listed(root: string, browser: Browser): string[] {
  const groups: Array<string | {resources?: string[]}> =
    JSON.parse(
      fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
    ).web_accessible_resources || []

  return groups
    .flatMap((group) =>
      typeof group === 'string' ? [group] : group.resources || []
    )
    .sort()
}

const CELLS: Array<[Browser, 2 | 3]> = [
  ['chrome', 3],
  ['firefox', 3],
  ['firefox', 2]
]

// An extension page fetches its own sheet's font from its own origin, so
// only the font a content script sheet loads needs an entry.
describe('a font only an extension page loads', () => {
  it.each(CELLS)(
    'ships unlisted on %s, manifest version %i',
    async (browser, manifestVersion) => {
      const root = project(manifestVersion)

      await build(root, browser)

      const dist = path.join(root, 'dist', browser)

      for (const font of [
        'fonts/page.woff2',
        'fonts/extra.woff2',
        'fonts/unused.ttf',
        'fonts/content.woff2'
      ]) {
        expect(fs.existsSync(path.join(dist, font)), font).toBe(true)
      }

      expect(listed(root, browser)).toEqual(['fonts/content.woff2'])
    },
    120_000
  )
})
