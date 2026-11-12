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
