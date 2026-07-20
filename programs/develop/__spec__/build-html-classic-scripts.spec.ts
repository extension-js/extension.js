import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

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

    const html = fs.readFileSync(
      path.join(distDir, 'action', 'index.html'),
      'utf8'
    )
    expect(html).toContain('/action/index.js')
    expect(html).not.toContain('type="module"')

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

    const bundleTagIndex = html.indexOf('/action/index.js')
    const inlineIndex = html.indexOf('Handlebars.compile')
    expect(bundleTagIndex).toBeGreaterThan(-1)
    expect(inlineIndex).toBeGreaterThan(-1)
    expect(bundleTagIndex).toBeLessThan(inlineIndex)

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
