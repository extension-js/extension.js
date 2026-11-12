import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A scripts/ file the background registers into the MAIN world runs in the
// page with no extension runtime, often at document_start before the page
// has a body. The generic chunk loader appends to document.body and threw
// there, so the bundle must carry the MAIN world loader a declared group gets.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rt-main-dyn-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'rt-main-dyn', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(
    path.join(root, 'scripts', 'lazy.js'),
    'export const lazy = "RT_MAIN_LAZY_VALUE"\n'
  )

  const hook =
    'import("./lazy.js").then(({lazy}) => { window.__PAGE_HOOK__ = lazy })\n'
  fs.writeFileSync(path.join(root, 'scripts', 'hook.js'), hook)
  fs.writeFileSync(path.join(root, 'scripts', 'isolated.js'), hook)
  fs.writeFileSync(path.join(root, 'scripts', 'injected.js'), hook)
  fs.writeFileSync(path.join(root, 'scripts', 'injected-isolated.js'), hook)
  fs.writeFileSync(
    path.join(root, 'declared.js'),
    hook.replace('./lazy.js', './scripts/lazy.js')
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.runtime.onInstalled.addListener(function () {',
      '  chrome.scripting.registerContentScripts([',
      '    {',
      '      id: "page-hook",',
      '      js: ["scripts/hook.js"],',
      '      world: "MAIN",',
      '      matches: ["<all_urls>"],',
      '      runAt: "document_start"',
      '    },',
      '    {',
      '      id: "isolated-hook",',
      '      js: ["scripts/isolated.js"],',
      '      matches: ["<all_urls>"]',
      '    }',
      '  ])',
      '})',
      'chrome.tabs.onUpdated.addListener(function (tabId) {',
      '  chrome.scripting.executeScript({',
      '    target: {tabId: tabId},',
      '    files: ["scripts/injected.js"],',
      '    world: "MAIN"',
      '  })',
      '  chrome.scripting.executeScript({',
      '    target: {tabId: tabId},',
      '    files: ["scripts/injected-isolated.js"]',
      '  })',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'rt-main-dyn',
      version: '1.0.0',
      permissions: ['scripting'],
      background: {service_worker: 'background.js'},
      content_scripts: [
        {
          matches: ['https://a.example/*'],
          js: ['declared.js'],
          world: 'MAIN',
          run_at: 'document_start'
        }
      ]
    })
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const read = (file: string) =>
    fs.readFileSync(path.join(distDir, file), 'utf8')

  return {read}
}

// The message type only the MAIN world loader carries.
const MAIN_WORLD_LOADER_MARK = 'EXTJS_WTW_LOAD'

describe('a runtime-registered MAIN world script that calls import()', () => {
  it('production: gets the MAIN world chunk loader a declared group gets', async () => {
    const built = await build(project())

    const declared = built.read('content_scripts/content-0.js')
    expect(declared).toContain(MAIN_WORLD_LOADER_MARK)

    const hook = built.read('scripts/hook.js')
    expect(hook).not.toContain('RT_MAIN_LAZY_VALUE')
    expect(hook).toContain(MAIN_WORLD_LOADER_MARK)

    // A registration with no world runs isolated and keeps the runtime loader.
    const isolated = built.read('scripts/isolated.js')
    expect(isolated).not.toContain(MAIN_WORLD_LOADER_MARK)
  }, 180_000)

  it('production: gives a file executeScript injects into the MAIN world the same loader', async () => {
    const built = await build(project())

    const injected = built.read('scripts/injected.js')
    expect(injected).not.toContain('RT_MAIN_LAZY_VALUE')
    expect(injected).toContain(MAIN_WORLD_LOADER_MARK)

    // An injection with no world runs isolated and keeps the runtime loader.
    const isolated = built.read('scripts/injected-isolated.js')
    expect(isolated).not.toContain(MAIN_WORLD_LOADER_MARK)
  }, 180_000)
})

// Every scripts/ file is an entry of its own, so the wrapper once built it a
// single time, as an isolated script, wherever it was imported from.
function importingProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-import-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'main-import', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'scripts'))
  fs.mkdirSync(path.join(root, 'content'))

  for (const name of ['static', 'dynamic', 'isolated']) {
    fs.writeFileSync(
      path.join(root, 'scripts', `lazy-${name}.js`),
      `window.__LAZY_MARK__ = "LAZY_${name.toUpperCase()}_VALUE"\nexport const lazy = 1\n`
    )
  }

  const importsStatic = 'import "./lazy-static.js"\nwindow.__HOOK__ = 1\n'
  const importsDynamic = 'import("./lazy-dynamic.js")\nwindow.__HOOK__ = 1\n'
  fs.writeFileSync(path.join(root, 'scripts', 'hook-static.js'), importsStatic)
  fs.writeFileSync(
    path.join(root, 'scripts', 'hook-dynamic.js'),
    importsDynamic
  )

  fs.writeFileSync(
    path.join(root, 'scripts', 'injected-static.js'),
    importsStatic
  )

  fs.writeFileSync(
    path.join(root, 'scripts', 'isolated.js'),
    'import "./lazy-isolated.js"\ndocument.title = "isolated"\n'
  )

  fs.writeFileSync(
    path.join(root, 'content', 'main-static.js'),
    importsStatic.replace('./', '../scripts/')
  )

  fs.writeFileSync(
    path.join(root, 'content', 'main-dynamic.js'),
    importsDynamic.replace('./', '../scripts/')
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.runtime.onInstalled.addListener(function () {',
      '  chrome.scripting.registerContentScripts([',
      '    {',
      '      id: "page-hook",',
      '      js: ["scripts/hook-static.js", "scripts/hook-dynamic.js"],',
      '      world: "MAIN",',
      '      matches: ["<all_urls>"],',
      '      runAt: "document_start"',
      '    },',
      '    {',
      '      id: "isolated-hook",',
      '      js: ["scripts/isolated.js"],',
      '      matches: ["<all_urls>"]',
      '    }',
      '  ])',
      '})',
      'chrome.tabs.onUpdated.addListener(function (tabId) {',
      '  chrome.scripting.executeScript({',
      '    target: {tabId: tabId},',
      '    files: ["scripts/injected-static.js"],',
      '    world: "MAIN"',
      '  })',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'main-import',
      version: '1.0.0',
      permissions: ['scripting'],
      background: {service_worker: 'background.js'},
      content_scripts: [
        {
          matches: ['https://a.example/*'],
          js: ['content/main-static.js'],
          world: 'MAIN',
          run_at: 'document_start'
        },
        {
          matches: ['https://b.example/*'],
          js: ['content/main-dynamic.js'],
          world: 'MAIN',
          run_at: 'document_start'
        }
      ]
    })
  )

  return root
}

// A global the wrapper sets on whatever window the bundle runs in.
const PAGE_GLOBAL_ASSIGNMENT =
  /(?:globalThis|window|self)\.__EXTENSIONJS_\w+\s*=(?!=)/

function splitChunksCarrying(root: string, mark: string): string[] {
  const distDir = path.join(root, 'dist', 'chrome')

  return fs
    .readdirSync(distDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
    .filter((source) => source.includes(mark))
}

describe('a scripts/ module a MAIN world entry imports', () => {
  it('production: plants no global on the page from a static import', async () => {
    const built = await build(importingProject())

    for (const file of [
      'scripts/hook-static.js',
      'scripts/injected-static.js',
      'content_scripts/content-0.js'
    ]) {
      const bundle = built.read(file)
      expect(bundle, file).toContain('LAZY_STATIC_VALUE')
      expect(bundle, file).not.toMatch(PAGE_GLOBAL_ASSIGNMENT)
    }
  }, 180_000)

  it('production: plants no global on the page from a split chunk', async () => {
    const root = importingProject()
    const built = await build(root)

    for (const file of [
      'scripts/hook-dynamic.js',
      'content_scripts/content-1.js'
    ]) {
      const bundle = built.read(file)
      expect(bundle, file).not.toContain('LAZY_DYNAMIC_VALUE')
      expect(bundle, file).not.toMatch(PAGE_GLOBAL_ASSIGNMENT)
    }

    const chunks = splitChunksCarrying(root, 'LAZY_DYNAMIC_VALUE')
    expect(chunks.length).toBeGreaterThan(0)

    for (const chunk of chunks) {
      expect(chunk).not.toMatch(PAGE_GLOBAL_ASSIGNMENT)
    }
  }, 180_000)

  it('production: leaves the same file built as its own entry and an isolated importer alone', async () => {
    const built = await build(importingProject())

    // The copy scripts/ emits as its own file may be injected anywhere.
    for (const name of ['static', 'dynamic', 'isolated']) {
      expect(built.read(`scripts/lazy-${name}.js`)).toMatch(
        PAGE_GLOBAL_ASSIGNMENT
      )
    }

    const isolated = built.read('scripts/isolated.js')
    expect(isolated).toContain('LAZY_ISOLATED_VALUE')
    expect(isolated.split('__EXTENSIONJS_registerCleanup=').length - 1).toBe(2)
  }, 180_000)
})

// A rule sees only the path of the importing module, and that path is the
// same for the copy inside a MAIN world bundle and the standalone one.
function chainProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-chain-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'main-chain', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'scripts'))
  fs.mkdirSync(path.join(root, 'content'))
  fs.mkdirSync(path.join(root, 'lib'))

  const files: Record<string, string> = {
    'scripts/deep.js': 'window.__DEEP__ = "DEEP_STATIC_VALUE"\n',
    'scripts/deep-dynamic.js': 'window.__DEEP__ = "DEEP_DYNAMIC_VALUE"\n',
    'scripts/deep-lib.js': 'window.__DEEP__ = "DEEP_LIB_VALUE"\n',
    'scripts/deep-styled.js': 'window.__DEEP__ = "DEEP_STYLED_VALUE"\n',
    'scripts/deep.css': '.deep-sheet-mark { color: rgb(1, 2, 3) }\n',
    'scripts/mid.js': 'import "./deep.js"\nwindow.__MID__ = 1\n',
    'scripts/mid-three.js': 'import "./mid.js"\nwindow.__MID_THREE__ = 1\n',
    'scripts/mid-dynamic.js':
      'import("./deep-dynamic.js")\nwindow.__MID_DYNAMIC__ = 1\n',
    'scripts/mid-styled.js':
      'import "./deep.css"\nimport "./deep-styled.js"\nwindow.__MID_STYLED__ = 1\n',
    'lib/mid.js': 'import "../scripts/deep-lib.js"\nwindow.__MID_LIB__ = 1\n',
    'scripts/hook-two.js': 'import "./mid.js"\nwindow.__HOOK__ = 1\n',
    'scripts/hook-three.js': 'import "./mid-three.js"\nwindow.__HOOK__ = 1\n',
    'scripts/hook-dynamic.js':
      'import("./mid-dynamic.js")\nwindow.__HOOK__ = 1\n',
    'scripts/hook-lib.js': 'import "../lib/mid.js"\nwindow.__HOOK__ = 1\n',
    'scripts/hook-diamond.js':
      'import "./deep.js"\nimport "./mid.js"\nwindow.__HOOK__ = 1\n',
    'scripts/hook-styled.js': 'import "./mid-styled.js"\nwindow.__HOOK__ = 1\n',
    'scripts/isolated.js': 'import "./mid.js"\ndocument.title = "isolated"\n',
    'scripts/isolated-styled.js':
      'import "./mid-styled.js"\ndocument.title = "isolated"\n',
    'content/main.js': 'import "../scripts/mid.js"\nwindow.__HOOK__ = 1\n'
  }

  for (const [file, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), source)
  }

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.runtime.onInstalled.addListener(function () {',
      '  chrome.scripting.registerContentScripts([',
      '    {',
      '      id: "page-hook",',
      '      js: [',
      '        "scripts/hook-two.js",',
      '        "scripts/hook-three.js",',
      '        "scripts/hook-dynamic.js",',
      '        "scripts/hook-lib.js",',
      '        "scripts/hook-diamond.js",',
      '        "scripts/hook-styled.js"',
      '      ],',
      '      world: "MAIN",',
      '      matches: ["<all_urls>"],',
      '      runAt: "document_start"',
      '    },',
      '    {',
      '      id: "isolated-hook",',
      '      js: ["scripts/isolated.js", "scripts/isolated-styled.js"],',
      '      matches: ["<all_urls>"]',
      '    }',
      '  ])',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'main-chain',
      version: '1.0.0',
      permissions: ['scripting'],
      background: {service_worker: 'background.js'},
      content_scripts: [
        {
          matches: ['https://a.example/*'],
          js: ['content/main.js'],
          world: 'MAIN',
          run_at: 'document_start'
        }
      ]
    })
  )

  return root
}

const CLEANUP_GLOBAL = '__EXTENSIONJS_registerCleanup='

function count(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('a scripts/ module a MAIN world entry reaches through another import', () => {
  it('production: plants no global on the page two and three imports down', async () => {
    const built = await build(chainProject())

    for (const [file, mark] of [
      ['scripts/hook-two.js', 'DEEP_STATIC_VALUE'],
      ['scripts/hook-three.js', 'DEEP_STATIC_VALUE'],
      ['scripts/hook-lib.js', 'DEEP_LIB_VALUE'],
      // Reached directly and through mid.js, and still one module.
      ['scripts/hook-diamond.js', 'DEEP_STATIC_VALUE'],
      ['content_scripts/content-0.js', 'DEEP_STATIC_VALUE']
    ]) {
      const bundle = built.read(file)
      expect(count(bundle, mark), file).toBe(1)
      expect(bundle, file).not.toMatch(PAGE_GLOBAL_ASSIGNMENT)
    }
  }, 180_000)

  it('production: plants no global on the page from a chunk a split chunk loads', async () => {
    const root = chainProject()
    const built = await build(root)

    const hook = built.read('scripts/hook-dynamic.js')
    expect(hook).not.toContain('DEEP_DYNAMIC_VALUE')
    expect(hook).not.toMatch(PAGE_GLOBAL_ASSIGNMENT)

    // One chunk rides the MAIN world bundle, the other belongs to the copy
    // scripts/mid-dynamic.js emits as its own file.
    const chunks = splitChunksCarrying(root, 'DEEP_DYNAMIC_VALUE')
    const planting = chunks.filter((chunk) =>
      PAGE_GLOBAL_ASSIGNMENT.test(chunk)
    )
    expect(chunks.length).toBe(2)
    expect(planting.length).toBe(1)
  }, 180_000)

  it('production: keeps a stylesheet imported down the chain in the bundle', async () => {
    const built = await build(chainProject())

    const hook = built.read('scripts/hook-styled.js')
    expect(hook).toContain('DEEP_STYLED_VALUE')
    expect(hook).toContain('deep-sheet-mark')
    expect(hook).not.toMatch(PAGE_GLOBAL_ASSIGNMENT)

    const isolated = built.read('scripts/isolated-styled.js')
    expect(isolated).toContain('deep-sheet-mark')
    expect(count(isolated, CLEANUP_GLOBAL)).toBe(3)
  }, 180_000)

  it('production: leaves the standalone copies and an isolated chain alone', async () => {
    const built = await build(chainProject())

    expect(count(built.read('scripts/deep.js'), CLEANUP_GLOBAL)).toBe(1)
    expect(count(built.read('scripts/mid.js'), CLEANUP_GLOBAL)).toBe(2)
    expect(count(built.read('scripts/mid-three.js'), CLEANUP_GLOBAL)).toBe(3)

    const isolated = built.read('scripts/isolated.js')
    expect(isolated).toContain('DEEP_STATIC_VALUE')
    expect(count(isolated, CLEANUP_GLOBAL)).toBe(3)
  }, 180_000)
})
