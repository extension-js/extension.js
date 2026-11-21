import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()

// Each writer is named by a line only its own runtime code emits, so a
// bundle answers which code set a value and in what order.
const PUBLIC_PATH = {
  bundler: '__webpack_require__.p = "/";',
  chunkLoader: '__webpack_require__.p = __extjsRuntimePath;',
  scriptsFeature:
    "__webpack_require__.p = typeof importScripts === 'function' ? path :"
}

const BASE_URI = {
  bundlerDocument:
    '__webpack_require__.b = document.baseURI || self.location.href;',
  bundlerWorker: '__webpack_require__.b = self.location + "/../../";',
  bundlerNone: '__webpack_require__.b = undefined;',
  chunkLoader:
    '__extjsBase = String(__webpack_require__.webExtRt.runtime.getURL("/"));',
  scriptsFeature: 'var __extjsApi = '
}

const LOAD_SCRIPT = {
  bundler: '__webpack_require__.l = function (url, done, key, chunkId)',
  chunkLoader: '__webpack_require__.l = dynamicImportLoader;'
}

// The wrapper sets both values again when the entry module runs, which is
// after every runtime module of the bundle.
const WRAPPER_PUBLIC_PATH = '__webpack_require__.p = base;'
const WRAPPER_BASE_URI = '__webpack_require__.b = base;'

const EXTENSION_WORLD_IMPORT = 'import(chrome.runtime.getURL(target))'
const MAIN_WORLD_IMPORT = 'import(url)'
const MAIN_WORLD_BRIDGE_REQUEST = 'EXTJS_WTW_LOAD'
const MAIN_WORLD_UNAIDED = 'unaidedLoaderMainWorld'
const CLASSIC_REQUEST = 'const msg = { type: "WTW_INJECT", file: url };'
const CLASSIC_REFUSAL = 'No script loader is found'
const CLASSIC_LISTENER = 'type != "WTW_INJECT"'

// A bundle evaluated where no extension API exists still gets a runtime
// object to ask, so reading the public path there cannot throw.
const API_STAND_IN =
  '__webpack_require__.webExtRt = { runtime: { getURL: String } };'

// Writers found in a bundle, in the order their code appears in it. The
// last runtime module in a file is the last to run before the entry.
function writers(text: string, table: Record<string, string>): string[] {
  return Object.entries(table)
    .map(([name, line]) => ({name, at: text.indexOf(line)}))
    .filter((found) => found.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((found) => found.name)
}

const lazy = (file: string, extra = '') =>
  `${extra}import('./${file}').then((m) => ` +
  "console.log(m.a, new URL('./pixel.png', import.meta.url).href))\n"

function scaffold(moduleWorker: boolean): string {
  const root = fs.realpathSync(tempFolder('extjs-chunk-runtime-'))

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'chunk-runtime',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'chunk-runtime',
      version: '1.0.0',
      background: {
        'chromium:service_worker': 'background.js',
        'firefox:scripts': ['background.js'],
        ...(moduleWorker ? {type: 'module'} : {})
      },
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['https://a.example/*'], js: ['isolated.js']},
        {matches: ['https://a.example/*'], js: ['main.js'], world: 'MAIN'}
      ]
    }),
    'pixel.png': 'pixel',
    'background.js': lazy('lazy-background.js'),
    'isolated.js': lazy(
      'lazy-isolated.js',
      "import pixel from './pixel.png'\n"
    ),
    'main.js': lazy('lazy-main.js'),
    'popup.html':
      '<!doctype html><html><body>' +
      '<script type="module" src="./popup.js"></script></body></html>\n',
    'popup.js': lazy('lazy-popup.js', "import pixel from './pixel.png'\n"),
    'lazy-background.js': 'export const a = "background"\n',
    'lazy-isolated.js': 'export const a = "isolated"\n',
    'lazy-main.js': 'export const a = "main"\n',
    'lazy-popup.js': 'export const a = "popup"\n'
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

interface Built {
  file: (name: RegExp) => string
  names: string[]
  entry: Record<string, {chunkLoading?: unknown}>
  targetInstalls: number
}

const count = (text: string, line: string) => text.split(line).length - 1

// The target taps the compiler once per install, and a bundle that loads
// chunks is given the loader once.
function expectOneChunkLoadingTarget(built: Built) {
  expect(built.targetInstalls).toBe(1)

  for (const world of [ISOLATED, PAGE]) {
    expect(count(built.file(world), LOAD_SCRIPT.chunkLoader)).toBe(1)
  }
}

// The whole plugin list a command gets, with readable output and no
// browser, written under the temp project.
async function build(options: {
  browser: 'chrome' | 'firefox'
  mode: 'development' | 'production'
  command: 'build' | 'dev'
  moduleWorker?: boolean
  reloadOff?: boolean
}): Promise<Built> {
  const root = scaffold(options.moduleWorker === true)
  const distPath = path.join(root, 'dist', options.browser)
  const structure = await getProjectStructure(root)

  // The plugins read the variable as they are applied, which is here.
  vi.stubEnv('EXTENSION_NO_RELOAD', options.reloadOff ? 'true' : undefined)

  const config = webpackConfig(structure, {
    browser: options.browser,
    mode: options.mode,
    metadataCommand: options.command,
    silent: true,
    output: {clean: true, path: distPath}
  } as Parameters<typeof webpackConfig>[1])

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  config.optimization = {...config.optimization, minimize: false}

  const compiler = rspack(config)
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)

  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result)
    )
  })
  await new Promise((resolve) => compiler.close(resolve))

  if (stats.hasErrors()) {
    throw new Error(
      stats.compilation.errors.map((error) => error.message).join('\n')
    )
  }

  const names = stats.compilation
    .getAssets()
    .map((asset) => asset.name)
    .filter((name) => name.endsWith('.js'))
    .sort()

  return {
    names,
    entry: compiler.options.entry as Built['entry'],
    targetInstalls: compiler.hooks.compilation.taps.filter(
      (tap) => tap.name === 'ChunkLoadingTarget'
    ).length,
    file: (name) => {
      const matches = names.filter((candidate) => name.test(candidate))

      if (matches.length !== 1) {
        throw new Error(`${name} matched ${matches.length} of ${names}`)
      }

      return fs.readFileSync(path.join(distPath, matches[0]), 'utf8')
    }
  }
}

const ISOLATED = /^content_scripts\/content-0(\.[0-9a-f]+)?\.js$/
const MAIN = /^content_scripts\/content-1(\.[0-9a-f]+)?\.js$/
const PAGE = /^action\/index\.js$/
const WORKER = /^background\/service_worker\.js$/
const BACKGROUND_SCRIPTS = /^background\/scripts\.js$/

beforeAll(() => {
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('chunk loading runtime of a production build for Chromium', () => {
  let built: Built

  beforeAll(async () => {
    built = await build({
      browser: 'chrome',
      mode: 'production',
      command: 'build'
    })
  })

  it('installs the chunk loading target once', () => {
    expectOneChunkLoadingTarget(built)
  })

  it('sets the public path of a content script from the scripts feature', () => {
    for (const world of [ISOLATED, MAIN]) {
      const text = built.file(world)

      expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
      expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
      expect(text).toContain(WRAPPER_PUBLIC_PATH)
      expect(text).toContain(WRAPPER_BASE_URI)
    }
  })

  it('loads an isolated world chunk through a native import', () => {
    const text = built.file(ISOLATED)

    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(EXTENSION_WORLD_IMPORT)
    expect(text).not.toContain(MAIN_WORLD_BRIDGE_REQUEST)
    expect(text).toContain(CLASSIC_REFUSAL)
    expect(text).not.toContain(CLASSIC_REQUEST)
  })

  it('loads a MAIN world chunk by URL with the bridge as its fallback', () => {
    const text = built.file(MAIN)

    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(MAIN_WORLD_IMPORT)
    expect(text).not.toContain(EXTENSION_WORLD_IMPORT)
    expect(text).toContain(MAIN_WORLD_BRIDGE_REQUEST)
    expect(text).not.toContain(MAIN_WORLD_UNAIDED)
  })

  it('gives an extension page the same public path and chunk loader', () => {
    const text = built.file(PAGE)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
    expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(EXTENSION_WORLD_IMPORT)
    expect(text).toContain(API_STAND_IN)
    expect(text).not.toContain(WRAPPER_PUBLIC_PATH)
  })

  it('ships a service worker with a base URI and no chunk loader', () => {
    const text = built.file(WORKER)

    expect(writers(text, PUBLIC_PATH)).toEqual([])
    expect(writers(text, LOAD_SCRIPT)).toEqual([])
    expect(writers(text, BASE_URI)).toEqual(['scriptsFeature', 'bundlerWorker'])
    expect(text).not.toContain(CLASSIC_LISTENER)
    expect(text).toContain('const a = "background"')
    expect(built.entry['background/service_worker'].chunkLoading).toBe(
      'import-scripts'
    )
  })

  it('gives a module service worker no chunk loader at all', async () => {
    const moduleWorker = await build({
      browser: 'chrome',
      mode: 'production',
      command: 'build',
      moduleWorker: true
    })

    expect(moduleWorker.entry['background/service_worker'].chunkLoading).toBe(
      false
    )

    expect(writers(moduleWorker.file(WORKER), BASE_URI)).toEqual([
      'bundlerNone',
      'scriptsFeature'
    ])
  })
})

describe('chunk loading runtime of a production build for Firefox', () => {
  let built: Built

  beforeAll(async () => {
    built = await build({
      browser: 'firefox',
      mode: 'production',
      command: 'build'
    })
  })

  it('installs the chunk loading target once', () => {
    expectOneChunkLoadingTarget(built)
  })

  it('treats the background scripts bundle as an extension page', () => {
    const text = built.file(BACKGROUND_SCRIPTS)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
    expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).not.toContain(CLASSIC_LISTENER)
  })

  it('leaves a MAIN world chunk with no fallback that names the extension', () => {
    const text = built.file(MAIN)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(MAIN_WORLD_IMPORT)
    expect(text).toContain(MAIN_WORLD_UNAIDED)
    expect(text).not.toContain(MAIN_WORLD_BRIDGE_REQUEST)
  })
})

describe('chunk loading runtime of a dev session for Chromium', () => {
  let built: Built

  beforeAll(async () => {
    built = await build({
      browser: 'chrome',
      mode: 'development',
      command: 'dev'
    })
  })

  it('installs the chunk loading target once', () => {
    expectOneChunkLoadingTarget(built)
  })

  it('sets the public path of a content script from the chunk loader', () => {
    const text = built.file(ISOLATED)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'chunkLoader'])
    expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
    expect(text).toContain(WRAPPER_PUBLIC_PATH)
    expect(text).toContain(WRAPPER_BASE_URI)
  })

  it('keeps the message fallback for an isolated world chunk', () => {
    const text = built.file(ISOLATED)

    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(EXTENSION_WORLD_IMPORT)
    expect(text).toContain(CLASSIC_REQUEST)
    expect(text).not.toContain(CLASSIC_REFUSAL)
  })

  it('answers the message fallback from the service worker', () => {
    const text = built.file(WORKER)

    expect(text).toContain(CLASSIC_LISTENER)
    expect(writers(text, PUBLIC_PATH)).toEqual([])
    expect(writers(text, LOAD_SCRIPT)).toEqual([])
    expect(writers(text, BASE_URI)).toEqual(['scriptsFeature', 'bundlerWorker'])
  })

  it('gives an extension page the same public path and chunk loader', () => {
    const text = built.file(PAGE)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'chunkLoader'])
    expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(API_STAND_IN)
    expect(text).not.toContain(WRAPPER_PUBLIC_PATH)
  })

  it('ships a MAIN world script whole, with no chunk loader', () => {
    const text = built.file(MAIN)

    expect(writers(text, LOAD_SCRIPT)).toEqual([])
    expect(writers(text, PUBLIC_PATH)).toEqual([])
    expect(text).toContain('const a = "main"')
  })
})

describe('chunk loading runtime of a dev session for Firefox', () => {
  let built: Built

  beforeAll(async () => {
    built = await build({
      browser: 'firefox',
      mode: 'development',
      command: 'dev'
    })
  })

  it('installs the chunk loading target once', () => {
    expectOneChunkLoadingTarget(built)
  })

  it('keeps the message fallback for an isolated world chunk', () => {
    const text = built.file(ISOLATED)

    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(CLASSIC_REQUEST)
    expect(text).not.toContain(CLASSIC_REFUSAL)
  })

  // The authored background.scripts files are bundled as background/scripts,
  // the page Firefox runs, so the request above is answered from there.
  it('answers the message fallback from the authored background scripts', () => {
    const text = built.file(BACKGROUND_SCRIPTS)

    expect(count(text, CLASSIC_LISTENER)).toBe(1)
    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'chunkLoader'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
  })
})

// A development build has no dev server and no reload client, so it loads
// chunks the way a production build does.
describe.each([
  'chrome',
  'firefox'
] as const)('chunk loading runtime of a development build with no session for %s', (browser) => {
  let built: Built

  beforeAll(async () => {
    built = await build({browser, mode: 'development', command: 'build'})
  })

  it('installs the chunk loading target once', () => {
    expectOneChunkLoadingTarget(built)
  })

  it('loads an isolated world chunk through a native import', () => {
    const text = built.file(ISOLATED)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
    expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(EXTENSION_WORLD_IMPORT)
    expect(text).toContain(CLASSIC_REFUSAL)
    expect(text).not.toContain(CLASSIC_REQUEST)
  })

  it('gives an extension page the same public path and chunk loader', () => {
    const text = built.file(PAGE)

    expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
    expect(writers(text, BASE_URI)).toEqual(['bundlerDocument'])
    expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
    expect(text).toContain(EXTENSION_WORLD_IMPORT)
    expect(text).toContain(API_STAND_IN)
    expect(text).not.toContain(CLASSIC_REQUEST)
  })

  // Development compiles a MAIN world script apart with its imports
  // inlined, so the file has no chunk to load in either kind of build.
  it('ships a MAIN world script whole, with no chunk loader', () => {
    const text = built.file(MAIN)

    expect(writers(text, LOAD_SCRIPT)).toEqual([])
    expect(writers(text, PUBLIC_PATH)).toEqual([])
    expect(text).toContain('const a = "main"')
  })

  it('adds no message fallback to the background', () => {
    const text = built.file(browser === 'firefox' ? BACKGROUND_SCRIPTS : WORKER)

    expect(text).not.toContain(CLASSIC_LISTENER)
    expect(text).not.toContain(CLASSIC_REQUEST)
  })
})

describe('chunk loading runtime of a dev session with reload turned off', () => {
  let built: Built

  beforeAll(async () => {
    built = await build({
      browser: 'chrome',
      mode: 'development',
      command: 'dev',
      reloadOff: true
    })
  })

  it('installs the chunk loading target once', () => {
    expectOneChunkLoadingTarget(built)
  })

  it('loads chunks the way a build with no session does', () => {
    for (const world of [ISOLATED, PAGE]) {
      const text = built.file(world)

      expect(writers(text, PUBLIC_PATH)).toEqual(['bundler', 'scriptsFeature'])
      expect(writers(text, LOAD_SCRIPT)).toEqual(['bundler', 'chunkLoader'])
      expect(text).toContain(EXTENSION_WORLD_IMPORT)
      expect(text).not.toContain(CLASSIC_REQUEST)
    }

    expect(built.file(WORKER)).not.toContain(CLASSIC_LISTENER)
  })
})
