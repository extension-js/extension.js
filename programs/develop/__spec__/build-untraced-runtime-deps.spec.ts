// Real-rspack regression gate for runtime-loaded file tracing — the corpus
// sweep's largest failure cluster (56/268 runtime failures at 4.0.4). Two
// classes of files load at runtime through APIs the module graph cannot see:
//
//   1. importScripts("lib/util.js") inside a classic background service
//      worker. The worker relocates to background/service_worker.js, and
//      importScripts resolves relative URLs against the worker's own URL, so
//      the dep must land at background/lib/util.js in dist.
//   2. chrome.scripting.executeScript({files: ["injected.js"]}) payloads,
//      which Chrome resolves against the extension root and executes as
//      classic content scripts — copied through verbatim.
//
// Before the fix both builds ended "Build succeeded with no warnings" while
// dist was missing the files. See TraceRuntimeLoadedFiles.

import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const IMPORTSCRIPTS_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-importscripts-')
)
const EXECUTESCRIPT_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-executescript-')
)
const MISSING_DEP_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-missing-dep-')
)
const TEMPLATE_LITERAL_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-template-literal-')
)
const FETCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-fetch-'))

function writePackageJson(root: string, name: string) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'}, null, 2)
  )
}

// Mirrors the corpus repro `a-importscripts`: classic worker at the project
// root pulling a sibling lib/ file, which chains a second importScripts call.
function writeImportScriptsFixture() {
  writePackageJson(IMPORTSCRIPTS_ROOT, 'extjs-build-importscripts-spec')
  fs.mkdirSync(path.join(IMPORTSCRIPTS_ROOT, 'lib'), {recursive: true})

  fs.writeFileSync(
    path.join(IMPORTSCRIPTS_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec — importScripts deps',
        version: '1.0.0',
        background: {service_worker: 'sw.js'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(IMPORTSCRIPTS_ROOT, 'sw.js'),
    [
      'importScripts("lib/util.js");',
      'console.log("util says:", typeof UTIL !== "undefined" ? UTIL : "MISSING");',
      ''
    ].join('\n')
  )

  // util.js chains a second importScripts — chained calls still resolve
  // against the worker URL, so both files must land under background/lib/.
  fs.writeFileSync(
    path.join(IMPORTSCRIPTS_ROOT, 'lib', 'util.js'),
    ['importScripts("lib/extra.js");', 'var UTIL = "loaded";', ''].join('\n')
  )

  fs.writeFileSync(
    path.join(IMPORTSCRIPTS_ROOT, 'lib', 'extra.js'),
    'var EXTRA = "loaded";\n'
  )
}

// Mirrors the corpus repro `b-executescript`: popup injects a root-level
// payload file via chrome.scripting.executeScript({files}).
function writeExecuteScriptFixture() {
  writePackageJson(EXECUTESCRIPT_ROOT, 'extjs-build-executescript-spec')

  fs.writeFileSync(
    path.join(EXECUTESCRIPT_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec — executeScript files',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        permissions: ['scripting', 'activeTab']
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(EXECUTESCRIPT_ROOT, 'popup.html'),
    '<html><body><script src="popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(
    path.join(EXECUTESCRIPT_ROOT, 'popup.js'),
    [
      'chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {',
      '  chrome.scripting.executeScript({',
      '    target: {tabId: tabs[0].id},',
      '    files: ["injected.js"]',
      '  })',
      '  chrome.scripting.insertCSS({',
      '    target: {tabId: tabs[0].id},',
      '    files: ["injected.css"]',
      '  })',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(EXECUTESCRIPT_ROOT, 'injected.js'),
    'document.title = "injected ran";\n'
  )
  fs.writeFileSync(
    path.join(EXECUTESCRIPT_ROOT, 'injected.css'),
    'body { outline: 1px solid red; }\n'
  )
}

// Worker references a dep that does not exist: the silent-breakage case must
// become a build warning instead of "Build succeeded with no warnings".
function writeMissingDepFixture() {
  writePackageJson(MISSING_DEP_ROOT, 'extjs-build-missing-dep-spec')

  fs.writeFileSync(
    path.join(MISSING_DEP_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec — missing importScripts dep',
        version: '1.0.0',
        background: {service_worker: 'sw.js'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(MISSING_DEP_ROOT, 'sw.js'),
    'importScripts("lib/nope.js");\n'
  )
}

// Mirrors the corpus repro `d-executescript-callback` (bug 7 / G30): the
// executeScript call's completion callback holds a multi-KB nested template
// literal. Minifiers hoist the callback into the call's own argument list, so
// the tracer's balanced-args read must survive argument spans well past the
// old 5000-char cap — and template-literal interpolations must not desync
// the string-aware scan.
function writeTemplateLiteralFixture() {
  writePackageJson(TEMPLATE_LITERAL_ROOT, 'extjs-build-template-literal-spec')

  fs.writeFileSync(
    path.join(TEMPLATE_LITERAL_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec — executeScript with big template literal',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        permissions: ['scripting', 'activeTab']
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(TEMPLATE_LITERAL_ROOT, 'popup.html'),
    '<html><body><script src="popup.js"></script></body></html>\n'
  )

  const fillerLines = Array.from(
    {length: 80},
    (_, index) =>
      `        <div class="row-${index}">filler content line ${index} with enough text to matter</div>`
  ).join('\n')

  fs.writeFileSync(
    path.join(TEMPLATE_LITERAL_ROOT, 'popup.js'),
    [
      'chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {',
      '  chrome.scripting.executeScript({',
      '    target: {tabId: tabs[0].id},',
      '    files: ["extract.js"]',
      '  }, () => {',
      '    const rows = [[1, 2, 3]]',
      '    const html = rows.map((row) => `',
      fillerLines,
      '      <span>${row.join(",")}</span>',
      '    `)',
      '    console.log(html.join(""))',
      '  })',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(TEMPLATE_LITERAL_ROOT, 'extract.js'),
    'document.title = "extracted";\n'
  )
}

// Mirrors the corpus repro `c-runtime-fetch` (bug 6 / G29): the popup fetches
// a package file by a page-relative literal. The page relocates in dist
// (popup.html -> action/index.html), so the file must land where the fetch
// resolves from the EMITTED page — action/data/config.json — and a fetch of
// a file that exists nowhere must warn instead of staying silent.
function writeFetchFixture() {
  writePackageJson(FETCH_ROOT, 'extjs-build-fetch-spec')
  fs.mkdirSync(path.join(FETCH_ROOT, 'data'), {recursive: true})

  fs.writeFileSync(
    path.join(FETCH_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec — runtime fetch deps',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(FETCH_ROOT, 'popup.html'),
    '<html><body><script src="popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(
    path.join(FETCH_ROOT, 'popup.js'),
    [
      'fetch("./data/config.json")',
      '  .then((response) => response.json())',
      '  .then((config) => console.log("config:", config))',
      'fetch("./data/nope.json").catch(() => {})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(FETCH_ROOT, 'data', 'config.json'),
    '{"greeting": "hello from config"}\n'
  )
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

beforeAll(() => {
  writeImportScriptsFixture()
  writeExecuteScriptFixture()
  writeMissingDepFixture()
  writeTemplateLiteralFixture()
  writeFetchFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(IMPORTSCRIPTS_ROOT, {recursive: true, force: true})
  fs.rmSync(EXECUTESCRIPT_ROOT, {recursive: true, force: true})
  fs.rmSync(MISSING_DEP_ROOT, {recursive: true, force: true})
  fs.rmSync(TEMPLATE_LITERAL_ROOT, {recursive: true, force: true})
  fs.rmSync(FETCH_ROOT, {recursive: true, force: true})
})

describe('build: untraced runtime-loaded deps (real rspack)', () => {
  it('copies classic-worker importScripts deps relative to the emitted worker', async () => {
    const summary = await buildFixture(IMPORTSCRIPTS_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(IMPORTSCRIPTS_ROOT, 'dist', 'chrome')
    const worker = fs.readFileSync(
      path.join(distDir, 'background', 'service_worker.js'),
      'utf8'
    )
    expect(worker).toContain('lib/util.js')

    // importScripts("lib/util.js") resolves against
    // chrome-extension://<id>/background/service_worker.js — the dep (and its
    // chained dep) must exist at background/lib/, byte-identical to source.
    const utilDist = path.join(distDir, 'background', 'lib', 'util.js')
    const extraDist = path.join(distDir, 'background', 'lib', 'extra.js')
    expect(fs.existsSync(utilDist), `missing ${utilDist}`).toBe(true)
    expect(fs.existsSync(extraDist), `missing ${extraDist}`).toBe(true)
    expect(fs.readFileSync(utilDist, 'utf8')).toBe(
      fs.readFileSync(path.join(IMPORTSCRIPTS_ROOT, 'lib', 'util.js'), 'utf8')
    )
  }, 120_000)

  it('copies executeScript/insertCSS files payloads verbatim at their literal paths', async () => {
    const summary = await buildFixture(EXECUTESCRIPT_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(EXECUTESCRIPT_ROOT, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'injected.js'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'injected.css'))).toBe(true)
    // Chrome executes these as classic content scripts at their literal
    // path — the copy must be verbatim, not bundled or wrapped.
    expect(fs.readFileSync(path.join(distDir, 'injected.js'), 'utf8')).toBe(
      'document.title = "injected ran";\n'
    )
  }, 120_000)

  it('keeps tracing executeScript files when the call carries a multi-KB template literal (G30)', async () => {
    const summary = await buildFixture(TEMPLATE_LITERAL_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(TEMPLATE_LITERAL_ROOT, 'dist', 'chrome')
    const extractDist = path.join(distDir, 'extract.js')
    expect(fs.existsSync(extractDist), `missing ${extractDist}`).toBe(true)
    expect(fs.readFileSync(extractDist, 'utf8')).toBe(
      'document.title = "extracted";\n'
    )
  }, 120_000)

  it('copies runtime-fetched package files relative to the relocated page, and warns on missing ones (G29)', async () => {
    const summary = await buildFixture(FETCH_ROOT)
    expect(summary.errors_count).toBe(0)

    // fetch("./data/config.json") resolves against the EMITTED page URL
    // (action/index.html), so the file must land at action/data/config.json.
    const distDir = path.join(FETCH_ROOT, 'dist', 'chrome')
    const configDist = path.join(distDir, 'action', 'data', 'config.json')
    expect(fs.existsSync(configDist), `missing ${configDist}`).toBe(true)
    expect(fs.readFileSync(configDist, 'utf8')).toBe(
      '{"greeting": "hello from config"}\n'
    )

    // fetch("./data/nope.json") exists nowhere — silent breakage must
    // surface as a build warning.
    expect(summary.warnings_count).toBeGreaterThan(0)
    expect(
      fs.existsSync(path.join(distDir, 'action', 'data', 'nope.json'))
    ).toBe(false)
  }, 120_000)

  it('warns (instead of silently breaking) when an importScripts dep is missing', async () => {
    const summary = await buildFixture(MISSING_DEP_ROOT)
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBeGreaterThan(0)

    const distDir = path.join(MISSING_DEP_ROOT, 'dist', 'chrome')
    expect(
      fs.existsSync(path.join(distDir, 'background', 'lib', 'nope.js'))
    ).toBe(false)
  }, 120_000)
})
