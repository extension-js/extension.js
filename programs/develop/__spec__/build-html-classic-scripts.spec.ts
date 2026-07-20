// Real-rspack regression gate for multi-classic-script HTML pages. The
// browser executes multiple <script src> tags in one shared global scope,
// `var storage` in lib/storage.js is visible to a sibling popup.js. Bundling
// each tag as a separate ES module isolates the scopes, and the built page
// throws `ReferenceError: storage is not defined` at boot (corpus class:
// Yunzenn__better-prompt). The fix routes all-classic script groups through
// the classic-concat loader (same contract as multi-file content_scripts),
// so the emitted bundle must actually EXECUTE with shared globals, asserted
// here by running it in a VM with a stubbed document.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import * as vm from 'vm'

const CLASSIC_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-html-classic-')
)
const MODULE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-html-module-')
)
const INLINE_CONSUMER_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-html-inline-')
)

function writePackageJson(root: string, name: string) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'}, null, 2)
  )
}

// Three classic scripts in tag order: a global definition, a consumer that
// extends it, and a final consumer reading both, the better-prompt shape.
function writeClassicFixture() {
  writePackageJson(CLASSIC_ROOT, 'extjs-build-html-classic-spec')
  fs.mkdirSync(path.join(CLASSIC_ROOT, 'lib'), {recursive: true})

  fs.writeFileSync(
    path.join(CLASSIC_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, HTML classic scripts',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(CLASSIC_ROOT, 'popup.html'),
    [
      '<html><body>',
      '<script src="lib/storage.js"></script>',
      '<script src="lib/format.js"></script>',
      '<script src="popup.js"></script>',
      '</body></html>',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(CLASSIC_ROOT, 'lib', 'storage.js'),
    'var storage = {value: "ok"};\n'
  )
  fs.writeFileSync(
    path.join(CLASSIC_ROOT, 'lib', 'format.js'),
    'function formatValue() { return "storage:" + storage.value; }\n'
  )
  fs.writeFileSync(
    path.join(CLASSIC_ROOT, 'popup.js'),
    'document.title = formatValue();\n'
  )
}

// A page with a type="module" script must NOT be folded into a classic
// concat, module semantics (scoped top level) are the author's choice.
function writeModuleFixture() {
  writePackageJson(MODULE_ROOT, 'extjs-build-html-module-spec')

  fs.writeFileSync(
    path.join(MODULE_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, HTML module scripts',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(MODULE_ROOT, 'popup.html'),
    [
      '<html><body>',
      '<script src="helper.js"></script>',
      '<script type="module" src="popup.js"></script>',
      '</body></html>',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(MODULE_ROOT, 'helper.js'),
    'globalThis.helperReady = true;\n'
  )
  fs.writeFileSync(
    path.join(MODULE_ROOT, 'popup.js'),
    'export const started = true;\ndocument.title = "module ran";\n'
  )
}

// The chrome-extensions-samples sandbox shape (BUGS_TO_FIX §38): ONE classic
// library <script src> in <head> declaring a top-level global, consumed at
// parse time by an INLINE <script> in <body>. In the browser the library's
// top-level `var` lands on window before the inline script runs; bundling it
// as an ES module scopes it inside the webpack closure and the inline
// consumer throws `ReferenceError: Handlebars is not defined`.
function writeInlineConsumerFixture() {
  writePackageJson(INLINE_CONSUMER_ROOT, 'extjs-build-html-inline-spec')

  fs.writeFileSync(
    path.join(INLINE_CONSUMER_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, classic script + inline consumer',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(INLINE_CONSUMER_ROOT, 'popup.html'),
    [
      '<html>',
      '<head><script src="handlebars.js"></script></head>',
      '<body>',
      '<script>document.title = Handlebars.compile("greeting")();</script>',
      '</body></html>',
      ''
    ].join('\n')
  )

  // Minimal stand-in for a vendored classic lib: top-level `var` global.
  fs.writeFileSync(
    path.join(INLINE_CONSUMER_ROOT, 'handlebars.js'),
    [
      'var Handlebars = {};',
      'Handlebars.compile = function (source) {',
      '  return function () { return "compiled:" + source; };',
      '};',
      ''
    ].join('\n')
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
  writeClassicFixture()
  writeModuleFixture()
  writeInlineConsumerFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(CLASSIC_ROOT, {recursive: true, force: true})
  fs.rmSync(MODULE_ROOT, {recursive: true, force: true})
  fs.rmSync(INLINE_CONSUMER_ROOT, {recursive: true, force: true})
})

describe('build: HTML pages with multiple classic scripts (real rspack)', () => {
  it('keeps cross-script implicit globals working in the built page bundle', async () => {
    const summary = await buildFixture(CLASSIC_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(CLASSIC_ROOT, 'dist', 'chrome')
    const bundlePath = path.join(distDir, 'action', 'index.js')
    expect(fs.existsSync(bundlePath), `missing ${bundlePath}`).toBe(true)

    // The page HTML must reference the bundle as a classic script, a
    // type="module" tag would give the concat bundle module semantics.
    const html = fs.readFileSync(
      path.join(distDir, 'action', 'index.html'),
      'utf8'
    )
    expect(html).toContain('/action/index.js')
    expect(html).not.toContain('type="module"')

    // Execute the bundle the way the browser would: before the fix this
    // throws `ReferenceError: storage is not defined` because each script
    // became an isolated ES module.
    const context = vm.createContext({document: {title: ''}})
    vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), context, {
      filename: 'action/index.js'
    })
    expect((context as any).document.title).toBe('storage:ok')
  }, 120_000)

  it('does not fold pages with type="module" scripts into a classic concat', async () => {
    const summary = await buildFixture(MODULE_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(MODULE_ROOT, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'action', 'index.js'))).toBe(true)
  }, 120_000)

  it('keeps an inline <script> consumer of a classic library global working', async () => {
    const summary = await buildFixture(INLINE_CONSUMER_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(INLINE_CONSUMER_ROOT, 'dist', 'chrome')
    const html = fs.readFileSync(
      path.join(distDir, 'action', 'index.html'),
      'utf8'
    )

    // The bundle tag must replace the library tag IN PLACE (head), not be
    // appended at the end of body, the inline consumer runs at parse time.
    const bundleTagIndex = html.indexOf('/action/index.js')
    const inlineIndex = html.indexOf('Handlebars.compile')
    expect(bundleTagIndex).toBeGreaterThan(-1)
    expect(inlineIndex).toBeGreaterThan(-1)
    expect(bundleTagIndex).toBeLessThan(inlineIndex)

    // Execute the page the way the browser would: bundle first (its tag
    // comes first), then the inline script. Before the fix the inline
    // script throws `ReferenceError: Handlebars is not defined`.
    const context = vm.createContext({document: {title: ''}})
    vm.runInContext(
      fs.readFileSync(path.join(distDir, 'action', 'index.js'), 'utf8'),
      context,
      {filename: 'action/index.js'}
    )
    expect((context as any).Handlebars).toBeDefined()

    const inlineOpen = html.indexOf('<script>')
    expect(inlineOpen).toBeGreaterThan(-1)
    const inlineClose = html.indexOf('</script>', inlineOpen)
    expect(inlineClose).toBeGreaterThan(-1)
    const inlineSource = html.slice(inlineOpen + '<script>'.length, inlineClose)
    vm.runInContext(inlineSource, context, {filename: 'inline-script'})
    expect((context as any).document.title).toBe('compiled:greeting')
  }, 120_000)
})
