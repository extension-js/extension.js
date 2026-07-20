// Real-rspack regression gate for runtime-loaded file tracing, the corpus
// sweep's largest failure cluster (56/268 runtime failures at 4.0.4). Two
// classes of files load at runtime through APIs the module graph cannot see:
//
//   1. importScripts("lib/util.js") inside a classic background service
//      worker. The worker relocates to background/service_worker.js, and
//      importScripts resolves relative URLs against the worker's own URL, so
//      the dep must land at background/lib/util.js in dist.
//   2. chrome.scripting.executeScript({files: ["injected.js"]}) payloads,
//      which Chrome resolves against the extension root and executes as
//      classic content scripts, copied through verbatim.
//
// Before the fix both builds ended "Build succeeded with no warnings" while
// dist was missing the files. See TraceRuntimeLoadedFiles.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

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
const GETURL_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-geturl-')
)
const WEBPACK_CHUNKS_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-webpack-chunks-')
)
const RUNTIME_SURFACE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-runtime-surface-')
)

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
        name: 'Build Spec, importScripts deps',
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

  // util.js chains a second importScripts, chained calls still resolve
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
        name: 'Build Spec, executeScript files',
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
        name: 'Build Spec, missing importScripts dep',
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
// old 5000-char cap, and template-literal interpolations must not desync
// the string-aware scan.
function writeTemplateLiteralFixture() {
  writePackageJson(TEMPLATE_LITERAL_ROOT, 'extjs-build-template-literal-spec')

  fs.writeFileSync(
    path.join(TEMPLATE_LITERAL_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, executeScript with big template literal',
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
// resolves from the EMITTED page (action/data/config.json) and a fetch of
// a file that exists nowhere must warn instead of staying silent.
function writeFetchFixture() {
  writePackageJson(FETCH_ROOT, 'extjs-build-fetch-spec')
  fs.mkdirSync(path.join(FETCH_ROOT, 'data'), {recursive: true})

  fs.writeFileSync(
    path.join(FETCH_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, runtime fetch deps',
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

// Mirrors the corpus repro `e-dynamic-import` (bug 8): chrome.runtime.getURL
// literals resolve against the extension ROOT regardless of the calling
// context, so a content script's import(chrome.runtime.getURL('common.js'))
// is traceable even though relative fetches from content scripts are not.
// The NAVIGATION variant (L8teNever) points getURL at an HTML page whose own
// src/href subresources must ship along with it.
function writeGetURLFixture() {
  writePackageJson(GETURL_ROOT, 'extjs-build-geturl-spec')
  fs.mkdirSync(path.join(GETURL_ROOT, 'ui'), {recursive: true})

  fs.writeFileSync(
    path.join(GETURL_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, getURL runtime deps',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}],
        web_accessible_resources: [
          {resources: ['common.js'], matches: ['<all_urls>']}
        ]
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(GETURL_ROOT, 'content.js'),
    [
      "import(chrome.runtime.getURL('common.js')).then((common) => {",
      "  console.log('common says:', common.MESSAGE)",
      '})',
      "import(chrome.runtime.getURL('nope.js')).catch(() => {})",
      ''
    ].join('\n')
  )
  // common.js carries a static relative import graph (bug 10): Chrome
  // resolves these against the module's own URL, so the copied root must
  // ship with its ./lib siblings, including a re-export hop.
  fs.mkdirSync(path.join(GETURL_ROOT, 'lib'), {recursive: true})
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'common.js'),
    [
      "import {WORD} from './lib/helper.js'",
      "export const MESSAGE = 'loaded ' + WORD",
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'lib', 'helper.js'),
    [
      "export * from './deeper.js'",
      "export const WORD = 'with-closure'",
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'lib', 'deeper.js'),
    'export const DEEP = true\n'
  )

  fs.writeFileSync(
    path.join(GETURL_ROOT, 'popup.html'),
    '<html><body><script src="popup.js"></script></body></html>\n'
  )
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'popup.js'),
    [
      'document.body.addEventListener("click", () => {',
      '  location.href = chrome.runtime.getURL("ui/page.html")',
      '})',
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'ui', 'page.html'),
    [
      '<html>',
      '  <head><link rel="stylesheet" href="page.css"></head>',
      '  <body><h1>ui page</h1><script src="page.js"></script></body>',
      '</html>',
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'ui', 'page.js'),
    "document.title = 'ui page ran'\n"
  )
  fs.writeFileSync(
    path.join(GETURL_ROOT, 'ui', 'page.css'),
    'h1 { color: rebeccapurple; }\n'
  )
}

// Mirrors the corpus repro `i-webpack-numeric-chunks` (bug 40): a prebuilt
// webpack5 bundle loads lazy chunks by NUMERIC id through publicPath
// concatenation (id + ".js" / id + ".css"), so the chunk filenames never
// exist as string literals, literal tracing is blind by construction. The
// runtime SHAPE must trigger a verbatim copy of numeric siblings instead.
function writeWebpackChunksFixture() {
  writePackageJson(WEBPACK_CHUNKS_ROOT, 'extjs-build-webpack-chunks-spec')

  fs.writeFileSync(
    path.join(WEBPACK_CHUNKS_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, webpack numeric chunks',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(WEBPACK_CHUNKS_ROOT, 'popup.html'),
    '<html><body><div id="root"></div><script src="popup.js"></script></body></html>\n'
  )

  // Minimal webpack5-shaped runtime: numeric-id URL construction with the
  // runtime's own ChunkLoadError literal (which survives minification when
  // the __webpack_require__ identifier does not).
  fs.writeFileSync(
    path.join(WEBPACK_CHUNKS_ROOT, 'popup.js'),
    [
      'var __webpack_require__ = {p: ""}',
      '__webpack_require__.u = (chunkId) => chunkId + ".js"',
      '__webpack_require__.miniCssF = (chunkId) => chunkId + ".css"',
      'var loadChunk = (chunkId) =>',
      '  new Promise((resolve, reject) => {',
      '    var url = __webpack_require__.p + __webpack_require__.u(chunkId)',
      '    var s = document.createElement("script")',
      '    s.src = url',
      '    s.onload = resolve',
      '    s.onerror = () =>',
      '      reject(new Error("ChunkLoadError: Loading chunk " + chunkId + " failed."))',
      '    document.head.appendChild(s)',
      '  })',
      'loadChunk(311).then(() => {',
      '  document.getElementById("root").textContent = "chunk 311: " + window.__chunk311',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(WEBPACK_CHUNKS_ROOT, '311.js'),
    'window.__chunk311 = "loaded";\n'
  )
  fs.writeFileSync(
    path.join(WEBPACK_CHUNKS_ROOT, '311.js.map'),
    '{"version":3,"sources":[],"mappings":""}\n'
  )
  fs.writeFileSync(
    path.join(WEBPACK_CHUNKS_ROOT, '812.css'),
    'body { background: papayawhip; }\n'
  )
}

// Mirrors the corpus repro `j-setpopup-html` (bug 41): a worker sets an HTML
// surface at runtime (chrome.action.setPopup / chrome.sidePanel.setOptions).
// The literal survives into the dist worker, but the page is not a manifest
// ref, untraced, the file (and its script closure) vanished from dist with
// zero warnings and the popup opened a 404 panel.
function writeRuntimeSurfaceFixture() {
  writePackageJson(RUNTIME_SURFACE_ROOT, 'extjs-build-runtime-surface-spec')

  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, runtime-set HTML surfaces',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        background: {service_worker: 'sw.js'},
        permissions: ['sidePanel']
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'popup.html'),
    '<html><body><p>manifest popup</p></body></html>\n'
  )

  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'sw.js'),
    [
      'chrome.action.setPopup({popup: "Alt.html"})',
      'chrome.sidePanel.setOptions({path: "Panel.html"})',
      '// offscreen documents are never manifest refs (§67):',
      'chrome.offscreen.createDocument({url: "offscreen/index.html", reasons: ["DOM_PARSER"], justification: "parse html"})',
      '// removing the popup is not a file reference:',
      'chrome.action.setPopup({popup: ""})',
      'chrome.action.setPopup({popup: "Missing.html"})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'Alt.html'),
    '<html><body><p>runtime-set popup</p><script src="alt.js"></script></body></html>\n'
  )
  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'alt.js'),
    'document.body.dataset.altLoaded = "yes";\n'
  )
  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'Panel.html'),
    '<html><body><p>runtime-set panel</p></body></html>\n'
  )
  fs.mkdirSync(path.join(RUNTIME_SURFACE_ROOT, 'offscreen'), {recursive: true})
  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'offscreen', 'index.html'),
    '<html><body><p>offscreen document</p><script src="offscreen.js"></script></body></html>\n'
  )
  fs.writeFileSync(
    path.join(RUNTIME_SURFACE_ROOT, 'offscreen', 'offscreen.js'),
    'document.body.dataset.offscreenLoaded = "yes";\n'
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
  writeGetURLFixture()
  writeWebpackChunksFixture()
  writeRuntimeSurfaceFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(GETURL_ROOT, {recursive: true, force: true})
  fs.rmSync(WEBPACK_CHUNKS_ROOT, {recursive: true, force: true})
  fs.rmSync(RUNTIME_SURFACE_ROOT, {recursive: true, force: true})
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
    // chrome-extension://<id>/background/service_worker.js, the dep (and its
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
    // path. The copy must be verbatim, not bundled or wrapped.
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

    // fetch("./data/nope.json") exists nowhere, silent breakage must
    // surface as a build warning.
    expect(summary.warnings_count).toBeGreaterThan(0)
    expect(
      fs.existsSync(path.join(distDir, 'action', 'data', 'nope.json'))
    ).toBe(false)
  }, 120_000)

  it('copies chrome.runtime.getURL() targets, dynamic import from a content script and an HTML page with its subresources (bug 8)', async () => {
    const summary = await buildFixture(GETURL_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(GETURL_ROOT, 'dist', 'chrome')

    // getURL resolves against the extension root, so common.js must ship at
    // the package root, verbatim (Chrome loads it as a real ES module file).
    const commonDist = path.join(distDir, 'common.js')
    expect(fs.existsSync(commonDist), `missing ${commonDist}`).toBe(true)
    expect(fs.readFileSync(commonDist, 'utf8')).toBe(
      fs.readFileSync(path.join(GETURL_ROOT, 'common.js'), 'utf8')
    )

    // Bug 10: the copied module's static relative import graph ships too,
    // one direct import hop plus a re-export hop, resolved against the
    // module's own URL.
    for (const rel of ['lib/helper.js', 'lib/deeper.js']) {
      const abs = path.join(distDir, rel)
      expect(fs.existsSync(abs), `missing ${abs}`).toBe(true)
    }

    // Bug 9: the consuming call site must stay a NATIVE dynamic import,
    // lowered into the bundler module map it throws
    // `Cannot find module 'chrome-extension://<id>/common.js'` at runtime.
    const contentBundle = fs.readFileSync(
      path.join(distDir, 'content_scripts', 'content-0.js'),
      'utf8'
    )
    expect(contentBundle).toMatch(
      /\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)?[\w.$]*runtime\.getURL\(/
    )
    expect(contentBundle).not.toContain('Cannot find module')

    // NAVIGATION variant: the getURL'd HTML page ships at its literal path
    // with its own src/href subresource closure.
    for (const rel of ['ui/page.html', 'ui/page.js', 'ui/page.css']) {
      const abs = path.join(distDir, rel)
      expect(fs.existsSync(abs), `missing ${abs}`).toBe(true)
    }

    // getURL of a file that exists nowhere must warn instead of staying
    // silent.
    expect(summary.warnings_count).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(distDir, 'nope.js'))).toBe(false)
  }, 120_000)

  it('copies numeric lazy chunks of a prebuilt webpack bundle, no literal exists to trace (bug 40)', async () => {
    const summary = await buildFixture(WEBPACK_CHUNKS_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(WEBPACK_CHUNKS_ROOT, 'dist', 'chrome')

    // publicPath "" resolves against the RELOCATED page URL (action/), and
    // publicPath "/" against the root. The chunks must exist at both.
    for (const rel of [
      '311.js',
      '311.js.map',
      '812.css',
      'action/311.js',
      'action/311.js.map',
      'action/812.css'
    ]) {
      const abs = path.join(distDir, rel)
      expect(fs.existsSync(abs), `missing ${abs}`).toBe(true)
    }
    // Chunks are prebuilt artifacts. The copy must be verbatim.
    expect(fs.readFileSync(path.join(distDir, '311.js'), 'utf8')).toBe(
      'window.__chunk311 = "loaded";\n'
    )
  }, 120_000)

  it('ships runtime-set HTML surfaces (setPopup/setOptions) with their script closure, and warns on missing ones (bug 41)', async () => {
    const summary = await buildFixture(RUNTIME_SURFACE_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(RUNTIME_SURFACE_ROOT, 'dist', 'chrome')

    // The literal survives in the emitted worker; the page and its
    // subresource closure must survive in dist alongside it.
    const worker = fs.readFileSync(
      path.join(distDir, 'background', 'service_worker.js'),
      'utf8'
    )
    expect(worker).toContain('Alt.html')

    for (const rel of [
      'Alt.html',
      'alt.js',
      'Panel.html',
      // Offscreen documents ride the same runtime-surface tracing (§67).
      path.join('offscreen', 'index.html'),
      path.join('offscreen', 'offscreen.js')
    ]) {
      const abs = path.join(distDir, rel)
      expect(fs.existsSync(abs), `missing ${abs}`).toBe(true)
    }
    expect(fs.readFileSync(path.join(distDir, 'Alt.html'), 'utf8')).toContain(
      'runtime-set popup'
    )

    // A runtime-set surface that exists nowhere must warn, not stay silent.
    expect(summary.warnings_count).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(distDir, 'Missing.html'))).toBe(false)
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
