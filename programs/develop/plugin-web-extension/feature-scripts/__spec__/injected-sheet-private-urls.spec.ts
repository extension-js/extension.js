import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {listOutput} from '../../../plugin-special-folders/__spec__/helpers/compile-harness'
import {
  build,
  canLink,
  expectNothingPrivate,
  expectNoWorkspaceAboveTemp,
  MARKER,
  manifest,
  project
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

// Whole production builds, one per target: a stylesheet the extension puts
// on a page names that target in a url(), and the row says what the output
// folder holds. Each way a sheet reaches the page is a table of its own.

// A row in one line: the output files besides the worker, each url() an
// output sheet holds, what the build said, and its error count. No output
// file of any row carries a marker, as text or inside a data URL.
type Table = Record<string, string>

interface Caller {
  name: string
  // The files that make the sheet reach a page, given the sheet's text.
  files: (css: string) => Record<string, string>
  manifest?: Record<string, unknown>
  // The folder the sheet sits in, which its targets are read from.
  folder?: string
}

const MATCHES = ['https://example.com/*']
const WORKER = {background: {service_worker: 'sw.js'}}

const CALLERS: Record<string, Caller> = {
  insertCss: {
    name: 'scripting.insertCSS({files})',
    files: (css) => ({
      'injected.css': css,
      'sw.js':
        'chrome.scripting.insertCSS({target: {tabId: 1}, files: ["injected.css"]})\n'
    })
  },
  registeredCss: {
    name: 'scripting.registerContentScripts({css})',
    files: (css) => ({
      'injected.css': css,
      'sw.js': `chrome.scripting.registerContentScripts([{id: "a", matches: ${JSON.stringify(MATCHES)}, css: ["injected.css"]}])\n`
    })
  },
  updatedCss: {
    name: 'scripting.updateContentScripts({css})',
    files: (css) => ({
      'injected.css': css,
      'sw.js': `chrome.scripting.updateContentScripts([{id: "a", css: ["injected.css"]}])\n`
    })
  },
  tabsInsertCss: {
    name: 'tabs.insertCSS({file})',
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
    files: (css) => ({
      'public/injected.css': css,
      'sw.js':
        'chrome.scripting.insertCSS({target: {tabId: 1}, files: ["injected.css"]})\n'
    })
  },
  // The bundler compiles the three below, so the stylesheet plugin is the
  // one that reads each target. It leaves the address of one it withholds.
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

// The stylesheet plugin says a file it withholds is not bundled, by a url()
// or an @import alike. Both read the terminal text, so each counts once.
const NOT_FOUND =
  /A url\(([^)]+)\) reference points to a file that exists nowhere in the project\. \(([^)]+)\)/g
const NOT_BUNDLED =
  /(\S+) is not bundled\. Check the url\(\) or @import that names it in this stylesheet\. \(([^)]+)\)/g

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
  const told: string[] = []

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

  for (const match of result.printed.matchAll(NOT_FOUND)) {
    told.push(`not found ${match[1]} in ${match[2]}`)
  }

  for (const match of result.printed.matchAll(NOT_BUNDLED)) {
    told.push(`not bundled ${match[1]} in ${match[2]}`)
  }

  // Nothing a private file holds is printed or in the output, by any route.
  expectNothingPrivate(result)
  expect(marked).toEqual([])

  return [
    result.shipped
      .filter((file) => file !== 'background/service_worker.js')
      .join(' + ') || 'nothing',
    ...(urls.length ? [`url ${urls.join(', ')}`] : []),
    ...(said.size + told.length
      ? [`said ${[...said, ...told].sort().join(', ')}`]
      : []),
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
      '.env.example + injected.css + inside.png + linked-in.png + logo.png + node_modules/pkg/icon.png | url /.env | said not bundled /.env in injected.css',
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
      'content_scripts/content-0.css + content_scripts/content-0.js | url ./.env | said not bundled ./.env in injected.css',
    '"./.env.local"':
      'content_scripts/content-0.css + content_scripts/content-0.js | url ./.env.local | said not bundled ./.env.local in injected.css',
    '.npmrc':
      'content_scripts/content-0.css + content_scripts/content-0.js | url .npmrc | said not bundled .npmrc in injected.css',
    '../outside.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url ../outside.png | said not bundled ../outside.png in injected.css',
    './linked.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url ./linked.png | said not bundled ./linked.png in injected.css',
    './node_modules/pkg/.env':
      'content_scripts/content-0.css + content_scripts/content-0.js | url ./node_modules/pkg/.env | said not bundled ./node_modules/pkg/.env in injected.css',
    '/.env':
      'content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/.env" | said not bundled /.env in injected.css',
    // The bundler drops an @import it does not follow, so the sheet is empty.
    '@import ./.env':
      'content_scripts/content-0.css + content_scripts/content-0.js | said not bundled ./.env in injected.css',
    '@font-face ./.git/font.woff2':
      'content_scripts/content-0.css + content_scripts/content-0.js | url ./.git/font.woff2 | said not bundled ./.git/font.woff2 in injected.css',
    './logo.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data>',
    './node_modules/pkg/icon.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data>',
    './linked-in.png':
      'content_scripts/content-0.css + content_scripts/content-0.js | url data:image/png;base64,<data>',
    './.env.example':
      'assets/.env.<hash>.example + content_scripts/content-0.css + content_scripts/content-0.js | url "chrome-extension://__MSG_@@extension_id__/assets/.env.<hash>.example"'
  },
  // The sheet rides inside the script, where the address stays as written.
  importedByContentScript: {
    './.env':
      'content_scripts/content-0.js | said not bundled ./.env in injected.css',
    '"./.env.local"':
      'content_scripts/content-0.js | said not bundled ./.env.local in injected.css',
    '.npmrc':
      'content_scripts/content-0.js | said not bundled .npmrc in injected.css',
    '../outside.png':
      'content_scripts/content-0.js | said not bundled ../outside.png in injected.css',
    './linked.png':
      'content_scripts/content-0.js | said not bundled ./linked.png in injected.css',
    './node_modules/pkg/.env':
      'content_scripts/content-0.js | said not bundled ./node_modules/pkg/.env in injected.css',
    '/.env':
      'content_scripts/content-0.js | said not bundled /.env in injected.css',
    '@import ./.env':
      'content_scripts/content-0.js | said not bundled ./.env in injected.css',
    '@font-face ./.git/font.woff2':
      'content_scripts/content-0.js | said not bundled ./.git/font.woff2 in injected.css',
    './logo.png': 'content_scripts/content-0.js',
    './node_modules/pkg/icon.png': 'content_scripts/content-0.js',
    './linked-in.png': 'content_scripts/content-0.js',
    './.env.example':
      'assets/.env.<hash>.example + content_scripts/content-0.js'
  },
  importedByScriptsFile: {
    './.env': 'scripts/tool.js | said not bundled ./.env in injected.css',
    '"./.env.local"':
      'scripts/tool.js | said not bundled ./.env.local in injected.css',
    '.npmrc': 'scripts/tool.js | said not bundled .npmrc in injected.css',
    '../outside.png':
      'scripts/tool.js | said not bundled ../outside.png in injected.css',
    './linked.png':
      'scripts/tool.js | said not bundled ./linked.png in injected.css',
    './node_modules/pkg/.env':
      'scripts/tool.js | said not bundled ./node_modules/pkg/.env in injected.css',
    '/.env': 'scripts/tool.js | said not bundled /.env in injected.css',
    '@import ./.env':
      'scripts/tool.js | said not bundled ./.env in injected.css',
    '@font-face ./.git/font.woff2':
      'scripts/tool.js | said not bundled ./.git/font.woff2 in injected.css',
    './logo.png': 'scripts/tool.js',
    './node_modules/pkg/icon.png': 'scripts/tool.js',
    './linked-in.png': 'scripts/tool.js',
    './.env.example': 'assets/.env.<hash>.example + scripts/tool.js'
  }
}

// A row for a file outside the project holds only where no folder above
// the temp folder is a workspace, which would make that file a shared one.
beforeAll(expectNoWorkspaceAboveTemp)

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
