import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A registration is read where it is written: in a module the entry
// imports, or through a constant of the same file.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const REGISTRATION = (file: string) =>
  `{id: "page-hook", js: ["${file}"], world: "MAIN", matches: ["<all_urls>"], runAt: "document_start"}`

const API = 'var api = globalThis.browser || globalThis.chrome\n'

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-imported-reg-'))
  roots.push(root)

  const all: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'imported-reg',
      version: '0.0.0'
    }),
    'media/blob.bin': Buffer.alloc(40_000),
    'scripts/hook.js':
      'import blobUrl from "../media/blob.bin?url"\n' +
      'window.__PAGE_HOOK__ = String(blobUrl)\n',
    'background.js': 'console.log("IMPORTED_REG_BACKGROUND")\n',
    'options/index.html':
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<script src="./options.js"></script></body></html>\n',
    'options/options.js': 'document.title = "IMPORTED_REG_OPTIONS"\n',
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'imported-reg',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['<all_urls>'],
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      options_ui: {page: 'options/index.html', open_in_tab: true},
      browser_specific_settings: {gecko: {id: 'imported-reg@example.com'}}
    }),
    ...files
  }

  for (const [name, contents] of Object.entries(all)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let warnings: string[] = []

  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
    warnings = (summary as {warnings?: string[]}).warnings || []
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)

  return {
    read: (file: string) => fs.readFileSync(path.join(distDir, file), 'utf8'),
    has: (file: string) => fs.existsSync(path.join(distDir, file)),
    relativePathWarnings: warnings.filter((text) =>
      text.includes('resolves that path against the page')
    )
  }
}

const CLEANUP = '__EXTENSIONJS_registerCleanup'
const PAIRING_MARK = '__extjsMainWorldBridgePaired'
const BRIDGE = 'scripts/extjs-main-world-bridge.js'

describe('a MAIN world registration the entry does not hold inline', () => {
  it('chrome: a module the background imports registers the file', async () => {
    const built = await build(
      project({
        'background.js': 'import "./register-hooks.js"\n',
        'register-hooks.js': `${API}api.scripting.registerContentScripts([${REGISTRATION('scripts/hook.js')}])\n`
      }),
      'chrome'
    )

    expect(built.read('scripts/hook.js')).toContain('__PAGE_HOOK__')
    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
  }, 180_000)

  it('firefox: a module the page imports registers the file and pairs the page', async () => {
    const built = await build(
      project({
        'options/options.js':
          'import {start} from "./components/registrar"\nstart()\n',
        'options/components/registrar.js': `${API}export function start() {\n  return api.scripting.registerContentScripts([${REGISTRATION('/scripts/hook.js')}])\n}\n`
      }),
      'firefox'
    )

    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
    expect(built.has(BRIDGE)).toBe(true)
    expect(built.read('options/index.js')).toContain(PAIRING_MARK)
    expect(built.relativePathWarnings).toEqual([])
  }, 180_000)

  it('chrome: a registration list held in a constant registers the file', async () => {
    const built = await build(
      project({
        'background.js': `${API}const hooks = [${REGISTRATION('scripts/hook.js')}]\napi.scripting.registerContentScripts(hooks)\n`
      }),
      'chrome'
    )

    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
  }, 180_000)

  it('firefox: a files list held in a constant pairs the background', async () => {
    const built = await build(
      project({
        'background.js':
          `${API}const files = ["scripts/hook.js"]\n` +
          'api.tabs.onUpdated.addListener(function (tabId) {\n' +
          '  api.scripting.executeScript({target: {tabId}, files, world: "MAIN"})\n})\n'
      }),
      'firefox'
    )

    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
    expect(built.has(BRIDGE)).toBe(true)
    expect(built.read('background/scripts.js')).toContain(PAIRING_MARK)
  }, 180_000)
})

describe('a MAIN world registration the build resolves its way to', () => {
  it('chrome: follows a resolve.alias of extension.config.js', async () => {
    const built = await build(
      project({
        'extension.config.mjs':
          'import path from "node:path"\n' +
          'import {fileURLToPath} from "node:url"\n' +
          'const here = path.dirname(fileURLToPath(import.meta.url))\n' +
          'export default {config: {resolve: {alias: {"@reg": path.join(here, "src/reg")}}}}\n',
        'background.js': 'import {start} from "@reg/register"\nstart()\n',
        'src/reg/register.js': `${API}export function start() {\n  return api.scripting.registerContentScripts([${REGISTRATION('scripts/hook.js')}])\n}\n`
      }),
      'chrome'
    )

    expect(built.read('scripts/hook.js')).toContain('__PAGE_HOOK__')
    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
  }, 180_000)

  it('firefox: follows a workspace package linked under node_modules', async () => {
    const workspace = project({
      'package.json': JSON.stringify({private: true, name: 'linked-reg-root'}),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
      'packages/shared/package.json': JSON.stringify({
        name: '@linked/shared',
        version: '0.0.0',
        main: 'index.js'
      }),
      'packages/shared/index.js': `${API}export function start() {\n  return api.scripting.registerContentScripts([${REGISTRATION('scripts/hook.js')}])\n}\n`
    })
    const root = path.join(workspace, 'apps/ext')

    fs.mkdirSync(root, {recursive: true})

    for (const name of ['manifest.json', 'scripts', 'media', 'options']) {
      fs.renameSync(path.join(workspace, name), path.join(root, name))
    }

    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        private: true,
        name: 'linked-reg',
        version: '0.0.0',
        dependencies: {'@linked/shared': 'workspace:*'}
      })
    )

    fs.writeFileSync(
      path.join(root, 'background.js'),
      'import {start} from "@linked/shared"\nstart()\n'
    )

    fs.mkdirSync(path.join(root, 'node_modules/@linked'), {recursive: true})
    fs.symlinkSync(
      path.join(workspace, 'packages/shared'),
      path.join(root, 'node_modules/@linked/shared'),
      'dir'
    )

    const built = await build(root, 'firefox')

    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
    expect(built.has(BRIDGE)).toBe(true)
    expect(built.read('background/scripts.js')).toContain(PAIRING_MARK)
  }, 180_000)

  it('firefox: reads a registration list another file exports', async () => {
    const built = await build(
      project({
        'background.js': `${API}import {HOOKS} from "./hooks"\napi.scripting.registerContentScripts(HOOKS)\n`,
        'hooks.js': `export const HOOKS = [${REGISTRATION('scripts/hook.js')}]\n`
      }),
      'firefox'
    )

    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
    expect(built.has(BRIDGE)).toBe(true)
    expect(built.read('background/scripts.js')).toContain(PAIRING_MARK)
  }, 180_000)
})

describe('a scripts/ path a page names without a leading slash', () => {
  const files = {
    'options/options.js': `${API}api.scripting.registerContentScripts([${REGISTRATION('scripts/hook.js')}])\n`
  }

  it('firefox: warns with the path to write instead', async () => {
    const built = await build(project(files), 'firefox')

    expect(built.relativePathWarnings).toHaveLength(1)

    const [warning] = built.relativePathWarnings

    expect(warning).toContain("options/options.js names 'scripts/hook.js'")
    expect(warning).toContain('options/scripts/hook.js')
    expect(warning).toContain('/scripts/hook.js')
    expect(warning).toContain('Start the path at the extension root')
  }, 180_000)

  it('chrome: says nothing, the path resolves against the root there', async () => {
    const built = await build(project(files), 'chrome')

    expect(built.relativePathWarnings).toEqual([])
    expect(built.read('scripts/hook.js')).not.toContain(CLEANUP)
  }, 180_000)
})
