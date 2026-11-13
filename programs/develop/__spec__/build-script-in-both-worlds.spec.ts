import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import {MAIN_WORLD_BRIDGE_PAIRING_MARK} from '../plugin-web-extension/feature-scripts/scripts-lib/main-world-bridge-pairing'
import {MAIN_WORLD_COPY_ROUTING_MARK} from '../plugin-web-extension/feature-scripts/scripts-lib/main-world-copy-routing'
import webpackConfig from '../rspack-config'

// A browser runs one file once in a frame whatever worlds name it, and each
// world needs its own build, so a file both worlds run ships twice.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const COPY = 'scripts/hook.extjs-main-world.js'
// The isolated build registers its cleanup on a global of its own world,
// which a build for the page never plants on the page.
const ISOLATED_BUILD_MARK = '__EXTENSIONJS_registerCleanup'
// A dev build for the isolated world patches the DOM it reads the page
// through, which a build that runs on the page itself must never do.
const ISOLATED_DEV_MARK = '__EXTENSIONJS_patchDomRemovalApis'
// The read a Firefox MAIN world file opens on, to take the extension base.
const TAKES_BASE = 'let __extjsTakenBase'

const BOTH =
  'chrome.scripting.registerContentScripts([\n' +
  "  {id: 'iso', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'ISOLATED'},\n" +
  "  {id: 'main', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'MAIN'}\n" +
  '])\n'
const COMPUTED =
  "const worlds = ['ISOLATED', 'MAIN']\n" +
  "chrome.scripting.registerContentScripts(worlds.map(world => ({id: 'h-' + world, js: ['scripts/hook.js'], matches: ['<all_urls>'], world})))\n"
const MAIN_ONLY =
  "chrome.scripting.registerContentScripts([{id: 'main', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'MAIN'}])\n"
const UNKNOWN =
  'chrome.storage.local.get("world").then(({world}) => {\n' +
  "  chrome.scripting.registerContentScripts([{id: 'main', js: ['scripts/hook.js'], matches: ['<all_urls>'], world}])\n" +
  '})\n'

function project(background: string) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-both-worlds-build-')
  )
  roots.push(root)

  const files: Record<string, string | Buffer> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'both-worlds',
      version: '0.0.0'
    }),
    'media/blob.bin': Buffer.alloc(40_000),
    'scripts/hook.module.css': '.box { outline: 7px solid rgb(1, 2, 3); }\n',
    'scripts/hook.js':
      'import blobUrl from "../media/blob.bin?url"\n' +
      'import styles from "./hook.module.css"\n' +
      'window.__BOTH_WORLDS_HOOK__ = String(blobUrl) + styles.box\n',
    'background.js': background,
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'both-worlds',
      version: '1.0.0',
      permissions: ['scripting', 'storage'],
      host_permissions: ['<all_urls>'],
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      browser_specific_settings: {gecko: {id: 'both-worlds@example.com'}}
    })
  }

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, ...name.split('/'))
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
    warnings = summary.warnings || []
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)
  const at = (file: string) => path.join(distDir, ...file.split('/'))

  return {
    warnings,
    read: (file: string) => fs.readFileSync(at(file), 'utf8'),
    has: (file: string) => fs.existsSync(at(file))
  }
}

// What the browser is handed when the built background registers.
function registeredBy(background: string) {
  const registered: Array<{id: string; js: string[]; world?: string}> = []
  const scripting = {
    registerContentScripts: (scripts: typeof registered) => {
      registered.push(...scripts)

      return Promise.resolve()
    },
    updateContentScripts: () => Promise.resolve(),
    unregisterContentScripts: () => Promise.resolve(),
    getRegisteredContentScripts: () => Promise.resolve([]),
    executeScript: () => Promise.resolve([])
  }
  const chrome = {
    scripting,
    runtime: {
      id: 'both',
      getURL: (file: string) => `chrome-extension://x/${file}`
    },
    storage: {local: {get: () => new Promise(() => {})}}
  }
  const context: Record<string, unknown> = {chrome, console, setTimeout}

  context.globalThis = context
  context.self = context
  vm.runInNewContext(background, context)

  return registered
}

const BACKGROUND = {
  chrome: 'background/service_worker.js',
  firefox: 'background/scripts.js'
} as const

describe('a scripts/ file the background registers in both worlds', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(`${browser}: ships a build for each world and routes the MAIN registration`, async () => {
      const built = await build(project(BOTH), browser)
      const isolated = built.read('scripts/hook.js')
      const main = built.read(COPY)
      const background = built.read(BACKGROUND[browser])

      expect(isolated).toContain(ISOLATED_BUILD_MARK)
      expect(main).not.toContain(ISOLATED_BUILD_MARK)
      expect(background).toContain(MAIN_WORLD_COPY_ROUTING_MARK)
      // Each build carries the sheet of its own CSS module.
      expect(isolated).toContain('outline:7px')
      expect(main).toContain('outline:7px')
      expect(built.has('scripts/hook.css')).toBe(false)
      expect(built.has('scripts/hook.extjs-main-world.css')).toBe(false)
    }, 180_000)
  }

  it('chrome: the built background registers each world with its own file', async () => {
    const built = await build(project(BOTH), 'chrome')

    expect(registeredBy(built.read(BACKGROUND.chrome))).toMatchObject([
      {id: 'iso', js: ['scripts/hook.js'], world: 'ISOLATED'},
      {id: 'main', js: [COPY], world: 'MAIN'}
    ])
  }, 180_000)

  it('firefox: pairs the bridge with the copy, and the copy takes the base', async () => {
    const built = await build(project(BOTH), 'firefox')
    const background = built.read(BACKGROUND.firefox)

    expect(built.has('scripts/extjs-main-world-bridge.js')).toBe(true)
    expect(background).toContain(`var READERS = ["${COPY}"];`)
    // The pairing runs first, so it is handed the names the routing settled.
    expect(background.indexOf(MAIN_WORLD_BRIDGE_PAIRING_MARK)).toBeLessThan(
      background.indexOf(MAIN_WORLD_COPY_ROUTING_MARK)
    )

    expect(built.read(COPY)).toContain(TAKES_BASE)
    expect(built.read('scripts/hook.js')).not.toContain(TAKES_BASE)
  }, 180_000)

  it('chrome: finds a registration that maps a list of worlds', async () => {
    const built = await build(project(COMPUTED), 'chrome')

    expect(built.has(COPY)).toBe(true)
    expect(built.read('scripts/hook.js')).toContain(ISOLATED_BUILD_MARK)
    expect(registeredBy(built.read(BACKGROUND.chrome))).toMatchObject([
      {id: 'h-ISOLATED', js: ['scripts/hook.js'], world: 'ISOLATED'},
      {id: 'h-MAIN', js: [COPY], world: 'MAIN'}
    ])
  }, 180_000)
})

describe('a scripts/ file one world runs', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(`${browser}: keeps its one build and a background with no routing`, async () => {
      const built = await build(project(MAIN_ONLY), browser)

      expect(built.has(COPY)).toBe(false)
      expect(built.read('scripts/hook.js')).not.toContain(ISOLATED_BUILD_MARK)
      expect(built.read(BACKGROUND[browser])).not.toContain(
        MAIN_WORLD_COPY_ROUTING_MARK
      )
    }, 180_000)
  }

  it('chrome: builds a world it cannot read for the isolated world and says so once', async () => {
    const built = await build(project(UNKNOWN), 'chrome')
    const named = built.warnings.filter((line) =>
      line.includes('whose world is only known when the call runs')
    )

    expect(built.has(COPY)).toBe(false)
    expect(built.read('scripts/hook.js')).toContain(ISOLATED_BUILD_MARK)
    expect(named).toHaveLength(1)
    expect(named[0]).toContain('background.js:2')
    expect(named[0]).toContain('isolated world script')
  }, 180_000)
})

// The dev server runs the bundler with HMR on, and that is what sends a MAIN
// world file to a compilation of its own, so the spec compiles the same way.
async function compileDev(root: string, browser: 'chrome' | 'firefox') {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.plugins.push(new rspack.HotModuleReplacementPlugin())
  config.stats = false

  const compiler: Compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => {
        if (error || !result) return reject(error || new Error('no stats'))

        resolve(result)
      })
    })
  })

  return {
    stats,
    read: (file: string) =>
      fs.readFileSync(path.join(distPath, ...file.split('/')), 'utf8')
  }
}

describe('a scripts/ file both worlds run, in a dev build', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(`${browser}: compiles the MAIN copy apart and keeps the isolated build`, async () => {
      const built = await compileDev(project(BOTH), browser)
      expect(built.stats.hasErrors()).toBe(false)

      const isolated = built.read('scripts/hook.js')
      const main = built.read(COPY)

      expect(isolated).toContain(ISOLATED_DEV_MARK)
      expect(main).not.toContain(ISOLATED_DEV_MARK)
      // The page gets no hot update runtime from the copy.
      expect(main).not.toContain('webpackHotUpdate')
      expect(main).toContain('__BOTH_WORLDS_HOOK__')
      expect(built.read(BACKGROUND[browser])).toContain(
        MAIN_WORLD_COPY_ROUTING_MARK
      )
    }, 180_000)
  }
})
