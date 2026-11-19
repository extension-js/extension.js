import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  compileFiles,
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {extendChunkLoadingTarget} from '../../shared/chunk-loading-target-extensions'
import {SetupChunkLoadingTarget} from '../index'

const makeTempFolder = trackTempFolders()

// The target reads no session, so a value from the shell must change nothing.
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
// and the entries it leaves alone. A fallback is asked for the way a dev
// session asks, before the target applies.
function installed(
  manifestPath: string,
  mode: 'development' | 'production',
  entry: Record<string, {import: string[]}> = {},
  devSession?: boolean,
  fallback?: {serviceWorkerEntry?: string; pageEntry?: string}
) {
  const compiler = idleCompiler(path.dirname(manifestPath), mode, entry)

  if (fallback) {
    extendChunkLoadingTarget(compiler, {fallbackBackground: () => fallback})
  }

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
  // The public path module of the scripts build answers first in every
  // build that asks for no fallback.
  const INSTALLED = {
    compilation: [
      'PublicPathRuntimeModule',
      'ChunkLoaderRuntime',
      'ChunkLoadingTarget'
    ],
    thisCompilation: ['NoDangerNamePlugin'],
    environment: ['ChunkLoadingTarget']
  }

  it('installs the web-extension target for a production build', () => {
    const {manifestPath} = project({
      'manifest.json': manifest,
      'background/index.js': ''
    })

    expect(installed(manifestPath, 'production')).toEqual({
      taps: INSTALLED,
      entry: {}
    })
  })

  // It is the one owner of the target, so what a session is never decides
  // whether it installs.
  it('installs the target once for every mode and session', () => {
    const {manifestPath} = project({'manifest.json': manifest})

    for (const mode of ['development', 'production'] as const) {
      for (const devSession of [undefined, true, false]) {
        expect(installed(manifestPath, mode, {}, devSession).taps).toEqual(
          INSTALLED
        )
      }
    }
  })

  it('installs the target the same way with EXTENSION_NO_RELOAD set', () => {
    const {manifestPath} = project({'manifest.json': manifest})
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')

    expect(installed(manifestPath, 'development', {}, true).taps).toEqual(
      INSTALLED
    )
  })

  // With a fallback asked for, the target answers the public path with its
  // own module, so the scripts one is never registered.
  it('answers the public path itself when a fallback is asked for', () => {
    const {manifestPath} = project({'manifest.json': manifest})

    expect(
      installed(manifestPath, 'development', {}, true, {
        serviceWorkerEntry: 'background/service_worker'
      }).taps
    ).toEqual({
      compilation: ['ChunkLoaderRuntime', 'ChunkLoadingTarget'],
      thisCompilation: ['NoDangerNamePlugin'],
      environment: ['ChunkLoadingTarget']
    })
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

describe('SetupChunkLoadingTarget with a message fallback', () => {
  function withFallback(
    manifestPath: string,
    background: {serviceWorkerEntry?: string; pageEntry?: string}
  ) {
    return {
      apply(compiler: Compiler) {
        extendChunkLoadingTarget(compiler, {
          fallbackBackground: () => background
        })

        target(manifestPath).apply(compiler)
      }
    }
  }

  // The loader a lazy chunk gets depends on the world the target reads off
  // the manifest, so a MAIN world script must come out with the bridge loader.
  it('hands the content script worlds to the chunk loader', async () => {
    const {root, manifestPath} = project({
      'manifest.json': {
        manifest_version: 3,
        name: 'worlds',
        version: '1.0.0',
        background: {service_worker: 'background.js'},
        content_scripts: [
          {matches: ['<all_urls>'], js: ['content/isolated.js']},
          {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
        ]
      },
      'background.js': '',
      'content/isolated.js': lazyImport,
      'content/main.js': lazyImport,
      'content/lazy.js': 'export const a = 1\n'
    })
    const {errors, files} = await compileFiles(
      root,
      {
        'content_scripts/content-0': 'content/isolated.js',
        'content_scripts/content-1': 'content/main.js'
      },
      withFallback(manifestPath, {
        serviceWorkerEntry: 'background/service_worker'
      }),
      'development'
    )

    expect(errors).toEqual([])
    expect(files['content_scripts/content-0.js']).not.toContain(
      MAIN_WORLD_LOADER
    )

    expect(files['content_scripts/content-1.js']).toContain(MAIN_WORLD_LOADER)
  })

  // The fallback is answered from the background the extension returns,
  // even where the manifest names another one.
  it('answers the fallback from the background it is handed', async () => {
    const {root, manifestPath} = project({
      'manifest.json': manifest,
      'background/index.js': '',
      'generated.js': '',
      'content/scripts.js': lazyImport,
      'content/lazy.js': 'export const a = 1\n'
    })
    const {errors, files} = await compileFiles(
      root,
      {
        'background/service_worker': 'background/index.js',
        'background/generated': 'generated.js',
        'content_scripts/content-0': 'content/scripts.js'
      },
      withFallback(manifestPath, {serviceWorkerEntry: 'background/generated'}),
      'development'
    )

    expect(errors).toEqual([])
    expect(files['background/generated.js']).toContain(CLASSIC_FALLBACK)
    expect(files['background/service_worker.js']).not.toContain(
      CLASSIC_FALLBACK
    )
  })
})
