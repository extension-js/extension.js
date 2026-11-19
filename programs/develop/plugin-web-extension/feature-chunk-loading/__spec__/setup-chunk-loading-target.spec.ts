import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  compileFiles,
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {SetupChunkLoadingTarget} from '../index'

const makeTempFolder = trackTempFolders()

// The gate reads the variable, so no value from the shell reaches a test.
beforeEach(() => {
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const manifest = {
  manifest_version: 3,
  name: 'chunk target',
  version: '1.0',
  background: {service_worker: 'background/index.js'},
  content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
}

function project(files: Record<string, string | object>) {
  const root = writeProject(makeTempFolder('extjs-chunk-target-'), files)

  return {root, manifestPath: path.join(root, 'manifest.json')}
}

function target(manifestPath: string, devSession?: boolean) {
  return new SetupChunkLoadingTarget({
    manifestPath,
    browser: 'chrome',
    devSession
  })
}

// What the target installs, read off an idle compiler: the taps it adds
// and the entries it leaves alone.
function installed(
  manifestPath: string,
  mode: 'development' | 'production',
  entry: Record<string, {import: string[]}> = {},
  devSession?: boolean
) {
  const compiler = idleCompiler(path.dirname(manifestPath), mode, entry)
  const taps = tapsAddedBy(compiler, () =>
    target(manifestPath, devSession).apply(compiler)
  )

  return {
    taps,
    entry: compiler.options.entry
  }
}

const lazyImport = "import('./lazy.js').then((m) => console.log(m))\n"
const MAIN_WORLD_LOADER = 'EXTJS_WTW_LOAD'
const EXTENSION_WORLD_LOADER = 'import(chrome.runtime.getURL(target))'
const CLASSIC_FALLBACK = 'WTW_INJECT'

// Regression for issue #507: a dynamic import() in a content script worked in
// `extension dev` and died with ChunkLoadError in `extension build`. The
// web-extension chunk-loading target was only ever registered by ReloadPlugin,
// which returns early in production, so a production build fell back to
// rspack's web target. That loader appends a <script> to the host document,
// which runs in the MAIN world while the content script lives in the isolated
// world, so the chunk never reaches the requester.
describe('SetupChunkLoadingTarget', () => {
  it('installs the web-extension target for a production build', () => {
    const {manifestPath} = project({
      'manifest.json': manifest,
      'background/index.js': ''
    })

    expect(installed(manifestPath, 'production')).toEqual({
      taps: {
        compilation: ['ChunkLoaderRuntime', 'ChunkLoadingTarget'],
        thisCompilation: ['NoDangerNamePlugin'],
        environment: ['ChunkLoadingTarget']
      },
      entry: {}
    })
  })

  // A reload session registers the same target through SetupReloadStrategy.
  // Applying both would install it twice.
  it('stays out of the way in a reload session, where the reload strategy owns it', () => {
    const {manifestPath} = project({'manifest.json': manifest})

    expect(installed(manifestPath, 'development').taps).toEqual({})
    expect(installed(manifestPath, 'development', {}, true).taps).toEqual({})
  })

  const INSTALLED = {
    compilation: ['ChunkLoaderRuntime', 'ChunkLoadingTarget'],
    thisCompilation: ['NoDangerNamePlugin'],
    environment: ['ChunkLoadingTarget']
  }

  // No reload plugin runs for these builds, so nothing else would replace
  // the loader that cannot reach an isolated world.
  it('installs the target for a development build with no session', () => {
    const {manifestPath} = project({'manifest.json': manifest})

    expect(installed(manifestPath, 'development', {}, false).taps).toEqual(
      INSTALLED
    )
  })

  it('installs the target for a dev session with reload turned off', () => {
    const {manifestPath} = project({'manifest.json': manifest})
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')

    expect(installed(manifestPath, 'development', {}, true).taps).toEqual(
      INSTALLED
    )
  })

  it('installs the target in production whatever the session says', () => {
    const {manifestPath} = project({'manifest.json': manifest})

    expect(installed(manifestPath, 'production', {}, true).taps).toEqual(
      INSTALLED
    )
  })

  it('never runs without a readable manifest', () => {
    const {root} = project({})

    expect(
      installed(path.join(root, 'missing', 'manifest.json'), 'production').taps
    ).toEqual({})
  })

  it('never synthesizes a background entry the author did not write', () => {
    const {manifestPath} = project({
      'manifest.json': {
        manifest_version: 3,
        name: 'no background',
        version: '1.0',
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      }
    })
    const result = installed(manifestPath, 'production')

    expect(result.entry).toEqual({})
  })
})

describe('SetupChunkLoadingTarget in a production compile', () => {
  // A service_worker path that resolves to no file produces no entry. The
  // target must not stop the build before the scripts feature reports it.
  it('compiles when the declared service worker file does not exist', async () => {
    const {root, manifestPath} = project({
      'manifest.json': {
        ...manifest,
        background: {service_worker: 'background/missing.js'}
      },
      'content/scripts.js': lazyImport,
      'content/lazy.js': 'export const a = 1\n'
    })
    const {errors, files} = await compileFiles(
      root,
      {'content_scripts/content-0': 'content/scripts.js'},
      target(manifestPath)
    )

    expect(errors).toEqual([])
    expect(files['content_scripts/content-0.js']).toContain(
      EXTENSION_WORLD_LOADER
    )
  })

  // The manifest never names a file the background registers at runtime, so
  // its world is read off the entry sources the scripts step created.
  it('loads chunks per world and adds no classic fallback to the worker', async () => {
    const {root, manifestPath} = project({
      'manifest.json': {
        ...manifest,
        content_scripts: [
          {matches: ['<all_urls>'], js: ['content/scripts.js']},
          {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
        ]
      },
      'background/index.js':
        'chrome.scripting.registerContentScripts([' +
        '{id: "a", js: ["scripts/hook.js"], world: "MAIN", matches: ["<all_urls>"]},' +
        '{id: "b", js: ["scripts/plain.js"], matches: ["<all_urls>"]}])\n' +
        lazyImport,
      'content/scripts.js': lazyImport,
      'content/main.js': lazyImport,
      'scripts/hook.js': lazyImport,
      'scripts/plain.js': lazyImport,
      'background/lazy.js': 'export const a = 1\n',
      'content/lazy.js': 'export const a = 1\n',
      'scripts/lazy.js': 'export const a = 1\n'
    })
    const {errors, files} = await compileFiles(
      root,
      {
        'background/service_worker': 'background/index.js',
        'content_scripts/content-0': 'content/scripts.js',
        'content_scripts/content-1': 'content/main.js',
        'scripts/hook': 'scripts/hook.js',
        'scripts/plain': 'scripts/plain.js'
      },
      target(manifestPath)
    )

    expect(errors).toEqual([])
    expect(files['content_scripts/content-0.js']).toContain(
      EXTENSION_WORLD_LOADER
    )

    expect(files['content_scripts/content-0.js']).not.toContain(
      MAIN_WORLD_LOADER
    )

    expect(files['content_scripts/content-1.js']).toContain(MAIN_WORLD_LOADER)
    expect(files['scripts/hook.js']).toContain(MAIN_WORLD_LOADER)
    expect(files['scripts/plain.js']).not.toContain(MAIN_WORLD_LOADER)

    // Regression: the classic loader adds a background runtime module that
    // lands bare at the top of a production service worker, which has no
    // webpack runtime to scope it, and the worker then dies on load with
    // `__webpack_require__ is not defined`.
    expect(files['background/service_worker.js']).not.toContain(
      CLASSIC_FALLBACK
    )
  })

  // executeScript names its file and its world the same way a registration
  // does, and the manifest names neither.
  it('marks a scripts/ entry the background injects into the MAIN world', async () => {
    const {root, manifestPath} = project({
      'manifest.json': manifest,
      'background/index.js':
        'chrome.tabs.onUpdated.addListener((tabId) => {' +
        'chrome.scripting.executeScript({target: {tabId}, files: ["scripts/hook.js"], world: "MAIN"});' +
        'browser.scripting.executeScript({target: {tabId}, files: ["scripts/plain.js"]})})\n',
      'scripts/hook.js': lazyImport,
      'scripts/plain.js': lazyImport,
      'scripts/lazy.js': 'export const a = 1\n'
    })
    const {errors, files} = await compileFiles(
      root,
      {
        'background/service_worker': 'background/index.js',
        'scripts/hook': 'scripts/hook.js',
        'scripts/plain': 'scripts/plain.js'
      },
      target(manifestPath)
    )

    expect(errors).toEqual([])
    expect(files['scripts/hook.js']).toContain(MAIN_WORLD_LOADER)
    expect(files['scripts/plain.js']).not.toContain(MAIN_WORLD_LOADER)
  })

  // Several background.scripts files enter as one generated module, which
  // hides the file that holds the registration from the entry list.
  it('finds a MAIN world registration in a background made of several files', async () => {
    const {root, manifestPath} = project({
      'manifest.json': {
        manifest_version: 3,
        name: 'split background',
        version: '1.0',
        background: {scripts: ['first.js', 'register.js']}
      },
      'first.js': '',
      'register.js':
        'chrome.scripting.registerContentScripts([' +
        '{id: "a", js: ["scripts/hook.js"], world: "MAIN", matches: ["<all_urls>"]}])\n',
      'scripts/hook.js': lazyImport,
      'scripts/lazy.js': 'export const a = 1\n'
    })
    const {errors, files} = await compileFiles(
      root,
      {
        'background/scripts': 'data:text/javascript;charset=utf-8,generated',
        'scripts/hook': 'scripts/hook.js'
      },
      target(manifestPath)
    )

    expect(errors).toEqual([])
    expect(files['scripts/hook.js']).toContain(MAIN_WORLD_LOADER)
  })
})
