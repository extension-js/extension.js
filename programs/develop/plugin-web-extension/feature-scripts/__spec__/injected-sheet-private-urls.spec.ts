import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {listOutput} from '../../../plugin-special-folders/__spec__/helpers/compile-harness'
import {
  build,
  canLink,
  expectNothingPrivate,
  MARKER,
  manifest,
  project
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

// Whole production builds, one per target: a stylesheet the extension puts
// on a page names that target in a url(), and the row says what the output
// folder holds. Each way a sheet reaches the page is a table of its own.

// A row in one line: the output files besides the worker, each url() an
// output sheet holds, `MARKED` with the output files that carry a marker as
// text or inside a data URL, what the build said, and its error count.
type Table = Record<string, string>

interface Caller {
  name: string
  // The files that make the sheet reach a page, given the sheet's text.
  files: (css: string) => Record<string, string>
  manifest?: Record<string, unknown>
  // The folder the sheet sits in, which its targets are read from.
  folder?: string
  // The scripts feature copies the sheet itself and asks before each read.
  // Left out where another step puts the target in the output today.
  guarded?: boolean
}

const MATCHES = ['https://example.com/*']
const WORKER = {background: {service_worker: 'sw.js'}}

const CALLERS: Record<string, Caller> = {
  insertCss: {
    name: 'scripting.insertCSS({files})',
    guarded: true,
    files: (css) => ({
      'injected.css': css,
      'sw.js':
        'chrome.scripting.insertCSS({target: {tabId: 1}, files: ["injected.css"]})\n'
    })
  },
  registeredCss: {
    name: 'scripting.registerContentScripts({css})',
    guarded: true,
    files: (css) => ({
      'injected.css': css,
      'sw.js': `chrome.scripting.registerContentScripts([{id: "a", matches: ${JSON.stringify(MATCHES)}, css: ["injected.css"]}])\n`
    })
  },
  updatedCss: {
    name: 'scripting.updateContentScripts({css})',
    guarded: true,
    files: (css) => ({
      'injected.css': css,
      'sw.js': `chrome.scripting.updateContentScripts([{id: "a", css: ["injected.css"]}])\n`
    })
  },
  tabsInsertCss: {
    name: 'tabs.insertCSS({file})',
    guarded: true,
    files: (css) => ({
      'injected.css': css,
      'sw.js': 'chrome.tabs.insertCSS(1, {file: "injected.css"})\n'
    })
  },
  // Ships byte for byte with the rest of public/. The copier leaves out
  // the link under public/ that leads out of the project, in every row.
  publicSheet: {
    name: 'scripting.insertCSS({files}) of a sheet under public/',
    folder: 'public/',
    guarded: true,
    files: (css) => ({
      'public/injected.css': css,
      'sw.js':
        'chrome.scripting.insertCSS({target: {tabId: 1}, files: ["injected.css"]})\n'
    })
  },
  // The bundler compiles the three below, so the stylesheet plugin is the
  // one that reads each target. Their marked rows change with its own guard.
  manifestCss: {
    name: 'content_scripts[].css',
    manifest: {
      content_scripts: [
        {matches: MATCHES, js: ['content.js'], css: ['injected.css']}
      ]
    },
    files: (css) => ({
      'injected.css': css,
      'content.js': 'console.log("content")\n',
      'sw.js': 'console.log("worker")\n'
    })
  },
  importedByContentScript: {
    name: 'a sheet a content script imports',
    manifest: {content_scripts: [{matches: MATCHES, js: ['content.js']}]},
    files: (css) => ({
      'injected.css': css,
      'content.js': 'import "./injected.css"\nconsole.log("content")\n',
      'sw.js': 'console.log("worker")\n'
    })
  },
  importedByScriptsFile: {
    name: 'a sheet a scripts/ file imports',
    files: (css) => ({
      'injected.css': css,
      'scripts/tool.js': 'import "../injected.css"\nconsole.log("tool")\n',
      'sw.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/tool.js"]})\n'
    })
  }
}

// The text of a sheet for each target, a rule per spelling.
const TARGETS: Record<string, string> = {
  './.env': 'body { background: url(./.env) }',
  '"./.env.local"': 'body { background: url("./.env.local") }',
  '.npmrc': 'body { background: url(.npmrc) }',
  '../outside.png': 'body { background: url(../outside.png) }',
  './linked.png': 'body { background: url(./linked.png) }',
  './node_modules/pkg/.env':
    'body { background: url(./node_modules/pkg/.env) }',
  '/.env': 'body { background: url(/.env) }',
  '@import ./.env': '@import url(./.env);',
  '@font-face ./.git/font.woff2':
    '@font-face { font-family: x; src: url(./.git/font.woff2) }',
  './logo.png': 'body { background: url(./logo.png) }',
  './node_modules/pkg/icon.png':
    'body { background: url(./node_modules/pkg/icon.png) }',
  './linked-in.png': 'body { background: url(./linked-in.png) }',
  './.env.example': 'body { background: url(./.env.example) }'
}

function fixture(caller: Caller, css: string) {
  const folder = caller.folder ?? ''
  const root = project({
    [`${folder}.env`]: `PRIVATE_KEY=${MARKER}-env\n`,
    [`${folder}.env.local`]: `PRIVATE_KEY=${MARKER}-env-local\n`,
    [`${folder}.npmrc`]: `# ${MARKER}-npmrc\n`,
    [`${folder}.git/font.woff2`]: `${MARKER}-git-font\n`,
    [`${folder}node_modules/pkg/.env`]: `KEY=${MARKER}-pkg-env\n`,
    [`${folder}node_modules/pkg/icon.png`]: 'PLAIN-TEXT-of(icon)\n',
    [`${folder}logo.png`]: 'PLAIN-TEXT-of(logo)\n',
    [`${folder}inside.png`]: 'PLAIN-TEXT-of(inside)\n',
    [`${folder}.env.example`]: 'EXAMPLE=PLAIN-TEXT-of(example)\n',
    ...caller.files(`${css}\n`),
    'manifest.json': manifest({...WORKER, ...caller.manifest})
  })
  const holder = path.dirname(root)
  const above = path.resolve(root, folder, '..', 'outside.png')

  fs.writeFileSync(above, `${MARKER}-outside-image\n`)

  if (above !== path.join(holder, 'outside.png')) {
    fs.writeFileSync(
      path.join(holder, 'outside.png'),
      `${MARKER}-outside-image\n`
    )
  }

  if (canLink) {
    fs.rmSync(path.join(root, folder, 'linked.png'), {force: true})
    fs.symlinkSync(
      path.join(holder, 'outside.png'),
      path.join(root, folder, 'linked.png')
    )

    fs.symlinkSync(
      path.join(root, folder, 'inside.png'),
      path.join(root, folder, 'linked-in.png')
    )
  }

  return root
}

// The words a build has for a target it left out.
const SAID: Array<[string, RegExp]> = [
  ['withheld', /names '([^']+)', but the file isn't in the output\./g],
  [
    'import left out',
    /(The build writes an imported sheet into the injected one), and this file isn't in the output\./g
  ]
]

// A marker a data URL carries, which a search of the text does not find.
function inlinesMarker(text: string): boolean {
  for (const match of text.matchAll(/base64,([A-Za-z0-9+/=]+)/g)) {
    if (Buffer.from(match[1], 'base64').toString().includes(MARKER)) {
      return true
    }
  }

  return false
}

const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=[."]|$)/, '.<hash>')

async function rowFor(caller: Caller, css: string): Promise<string> {
  const root = fixture(caller, css)
  const result = await build(root)
  const out = listOutput(path.join(root, 'dist', 'chrome'))
  const said = new Set<string>()

  for (const [kind, pattern] of SAID) {
    for (const match of result.printed.matchAll(pattern)) {
      said.add(kind === 'withheld' ? `${kind} ${match[1]}` : kind)
    }
  }

  const urls = Object.keys(out)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .flatMap((name) =>
      [...out[name].matchAll(/url\(([^)]*)\)/g)].map((match) =>
        withoutHash(match[1].replace(/^(data:[^,]+,).*$/, '$1<data>'))
      )
    )
  const marked = Object.keys(out)
    .filter((name) => out[name].includes(MARKER) || inlinesMarker(out[name]))
    .map(withoutHash)
    .sort()

  // Whatever the output holds, nothing a private file holds is printed.
  expectNothingPrivate(result, caller.guarded ? 'everywhere' : 'printed')

  if (caller.guarded) expect(marked).toEqual([])

  return [
    result.shipped
      .filter((file) => file !== 'background/service_worker.js')
      .join(' + ') || 'nothing',
    ...(urls.length ? [`url ${urls.join(', ')}`] : []),
    ...(marked.length ? [`MARKED ${marked.join(', ')}`] : []),
    ...(said.size ? [`said ${[...said].sort().join(', ')}`] : []),
    ...(result.errors ? [`errors ${result.errors}`] : [])
  ].join(' | ')
}

async function tableFor(caller: Caller): Promise<Table> {
  const table: Table = {}

  for (const [target, css] of Object.entries(TARGETS)) {
    table[target] = await rowFor(caller, css)
  }

  return table
}

const TIMEOUT = 600_000

const EXPECTED: Record<string, Table> = {
  insertCss: {
    './.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld ./.env',
    '"./.env.local"':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.local" | said withheld ./.env.local',
    '.npmrc':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.npmrc" | said withheld .npmrc',
    '../outside.png':
      'injected.css | url ../outside.png | said withheld ../outside.png',
    './linked.png':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/linked.png" | said withheld ./linked.png',
    './node_modules/pkg/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/.env" | said withheld ./node_modules/pkg/.env',
    '/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld /.env',
    '@import ./.env':
      'injected.css | url ./.env | said import left out, withheld ./.env',
    '@font-face ./.git/font.woff2':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.git/font.woff2" | said withheld ./.git/font.woff2',
    './logo.png':
      'injected.css + logo.png | url "chrome-extension://__MSG_@@extension_id__/logo.png"',
    './node_modules/pkg/icon.png':
      'injected.css + node_modules/pkg/icon.png | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/icon.png"',
    './linked-in.png':
      'injected.css + linked-in.png | url "chrome-extension://__MSG_@@extension_id__/linked-in.png"',
    './.env.example':
      '.env.example + injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.example"'
  },
  registeredCss: {
    './.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld ./.env',
    '"./.env.local"':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.local" | said withheld ./.env.local',
    '.npmrc':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.npmrc" | said withheld .npmrc',
    '../outside.png':
      'injected.css | url ../outside.png | said withheld ../outside.png',
    './linked.png':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/linked.png" | said withheld ./linked.png',
    './node_modules/pkg/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/.env" | said withheld ./node_modules/pkg/.env',
    '/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld /.env',
    '@import ./.env':
      'injected.css | url ./.env | said import left out, withheld ./.env',
    '@font-face ./.git/font.woff2':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.git/font.woff2" | said withheld ./.git/font.woff2',
    './logo.png':
      'injected.css + logo.png | url "chrome-extension://__MSG_@@extension_id__/logo.png"',
    './node_modules/pkg/icon.png':
      'injected.css + node_modules/pkg/icon.png | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/icon.png"',
    './linked-in.png':
      'injected.css + linked-in.png | url "chrome-extension://__MSG_@@extension_id__/linked-in.png"',
    './.env.example':
      '.env.example + injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.example"'
  },
  updatedCss: {
    './.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld ./.env',
    '"./.env.local"':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.local" | said withheld ./.env.local',
    '.npmrc':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.npmrc" | said withheld .npmrc',
    '../outside.png':
      'injected.css | url ../outside.png | said withheld ../outside.png',
    './linked.png':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/linked.png" | said withheld ./linked.png',
    './node_modules/pkg/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/.env" | said withheld ./node_modules/pkg/.env',
    '/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld /.env',
    '@import ./.env':
      'injected.css | url ./.env | said import left out, withheld ./.env',
    '@font-face ./.git/font.woff2':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.git/font.woff2" | said withheld ./.git/font.woff2',
    './logo.png':
      'injected.css + logo.png | url "chrome-extension://__MSG_@@extension_id__/logo.png"',
    './node_modules/pkg/icon.png':
      'injected.css + node_modules/pkg/icon.png | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/icon.png"',
    './linked-in.png':
      'injected.css + linked-in.png | url "chrome-extension://__MSG_@@extension_id__/linked-in.png"',
    './.env.example':
      '.env.example + injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.example"'
  },
  tabsInsertCss: {
    './.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld ./.env',
    '"./.env.local"':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.local" | said withheld ./.env.local',
    '.npmrc':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.npmrc" | said withheld .npmrc',
    '../outside.png':
      'injected.css | url ../outside.png | said withheld ../outside.png',
    './linked.png':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/linked.png" | said withheld ./linked.png',
    './node_modules/pkg/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/.env" | said withheld ./node_modules/pkg/.env',
    '/.env':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.env" | said withheld /.env',
    '@import ./.env':
      'injected.css | url ./.env | said import left out, withheld ./.env',
    '@font-face ./.git/font.woff2':
      'injected.css | url "chrome-extension://__MSG_@@extension_id__/.git/font.woff2" | said withheld ./.git/font.woff2',
    './logo.png':
      'injected.css + logo.png | url "chrome-extension://__MSG_@@extension_id__/logo.png"',
    './node_modules/pkg/icon.png':
      'injected.css + node_modules/pkg/icon.png | url "chrome-extension://__MSG_@@extension_id__/node_modules/pkg/icon.png"',
    './linked-in.png':
      'injected.css + linked-in.png | url "chrome-extension://__MSG_@@extension_id__/linked-in.png"',
    './.env.example':
      '.env.example + injected.css | url "chrome-extension://__MSG_@@extension_id__/.env.example"'
  },
  publicSheet: {
    './.env':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./.env',
    '"./.env.local"':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url "./.env.local"',
    '.npmrc':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url .npmrc',
    '../outside.png':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ../outside.png',
    './linked.png':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./linked.png',
    './node_modules/pkg/.env':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./node_modules/pkg/.env',
    '/.env':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url /.env',
    '@import ./.env':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./.env',
    '@font-face ./.git/font.woff2':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./.git/font.woff2',
    './logo.png':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./logo.png',
    './node_modules/pkg/icon.png':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./node_modules/pkg/icon.png',
    './linked-in.png':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./linked-in.png',
    './.env.example':
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url ./.env.example'
  },
  manifestCss: {
    './.env':
      'assets/.env.<hash> + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.env.<hash>" | MARKED assets/.env.<hash>',
    '"./.env.local"':
      'assets/.env.<hash>.local + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.env.<hash>.local" | MARKED assets/.env.<hash>.local',
    '.npmrc':
      'assets/.npmrc.<hash> + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.npmrc.<hash>" | MARKED assets/.npmrc.<hash>',
    '../outside.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data> | MARKED content_scripts/content-0.css',
    './linked.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data> | MARKED content_scripts/content-0.css',
    './node_modules/pkg/.env':
      'assets/.env.<hash> + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.env.<hash>" | MARKED assets/.env.<hash>',
    '/.env':
      'assets/.env.<hash> + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.env.<hash>" | MARKED assets/.env.<hash>',
    '@import ./.env':
      'content_scripts/content-0.css + content_scripts/content-0.js | MARKED content_scripts/content-0.js',
    '@font-face ./.git/font.woff2':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:font/woff2;base64,<data> | MARKED content_scripts/content-0.css',
    './logo.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data>',
    './node_modules/pkg/icon.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data>',
    './linked-in.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data>',
    './.env.example':
      'assets/.env.<hash>.example + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.env.<hash>.example"'
  },
  importedByContentScript: {
    './.env':
      'assets/.env.<hash> + content_scripts/content-0.js | MARKED assets/.env.<hash>',
    '"./.env.local"':
      'assets/.env.<hash>.local + content_scripts/content-0.js | MARKED assets/.env.<hash>.local',
    '.npmrc':
      'assets/.npmrc.<hash> + content_scripts/content-0.js | MARKED assets/.npmrc.<hash>',
    '../outside.png':
      'content_scripts/content-0.js | MARKED content_scripts/content-0.js',
    './linked.png':
      'content_scripts/content-0.js | MARKED content_scripts/content-0.js',
    './node_modules/pkg/.env':
      'assets/.env.<hash> + content_scripts/content-0.js | MARKED assets/.env.<hash>',
    '/.env':
      'assets/.env.<hash> + content_scripts/content-0.js | MARKED assets/.env.<hash>',
    '@import ./.env':
      'assets/.env.<hash> + content_scripts/content-0.js | MARKED assets/.env.<hash>',
    '@font-face ./.git/font.woff2':
      'content_scripts/content-0.js | MARKED content_scripts/content-0.js',
    './logo.png': 'content_scripts/content-0.js',
    './node_modules/pkg/icon.png': 'content_scripts/content-0.js',
    './linked-in.png': 'content_scripts/content-0.js',
    './.env.example':
      'assets/.env.<hash>.example + content_scripts/content-0.js'
  },
  importedByScriptsFile: {
    './.env':
      'assets/.env.<hash> + scripts/tool.js | MARKED assets/.env.<hash>',
    '"./.env.local"':
      'assets/.env.<hash>.local + scripts/tool.js | MARKED assets/.env.<hash>.local',
    '.npmrc':
      'assets/.npmrc.<hash> + scripts/tool.js | MARKED assets/.npmrc.<hash>',
    '../outside.png': 'scripts/tool.js | MARKED scripts/tool.js',
    './linked.png': 'scripts/tool.js | MARKED scripts/tool.js',
    './node_modules/pkg/.env':
      'assets/.env.<hash> + scripts/tool.js | MARKED assets/.env.<hash>',
    '/.env': 'assets/.env.<hash> + scripts/tool.js | MARKED assets/.env.<hash>',
    '@import ./.env':
      'assets/.env.<hash> + scripts/tool.js | MARKED assets/.env.<hash>',
    '@font-face ./.git/font.woff2': 'scripts/tool.js | MARKED scripts/tool.js',
    './logo.png': 'scripts/tool.js',
    './node_modules/pkg/icon.png': 'scripts/tool.js',
    './linked-in.png': 'scripts/tool.js',
    './.env.example': 'assets/.env.<hash>.example + scripts/tool.js'
  }
}

describe.skipIf(!canLink).each(Object.keys(CALLERS))('%s', (key) => {
  it(
    'names each target',
    async () => {
      const actual = await tableFor(CALLERS[key])

      expect(actual).toEqual(EXPECTED[key])
    },
    TIMEOUT
  )
})
