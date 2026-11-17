import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  compileFiles,
  idleCompiler,
  tapsAddedBy,
  workerEntryFromFork,
  writeProject
} from '../../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {SetupChunkLoadingTarget} from '../index'

const makeTempFolder = trackTempFolders()

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

function target(manifestPath: string) {
  return new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'})
}

// What the fork installs, read off an idle compiler: the worker entry its
// entryOption tap names and the public path it clears for rspack.
function installed(
  manifestPath: string,
  mode: 'development' | 'production',
  entry: Record<string, {import: string[]}> = {}
) {
  const compiler = idleCompiler(path.dirname(manifestPath), mode, entry)
  const taps = tapsAddedBy(compiler, () => target(manifestPath).apply(compiler))

  return {
    taps,
    workerEntry: workerEntryFromFork(compiler),
    publicPath: compiler.options.output.publicPath,
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
        entryOption: ['WebExtensionServiceWorkerEntryPlugin'],
        compilation: [
          'WebExtensionChuckLoaderRuntimePlugin',
          'WebExtensionPlugin'
        ],
        thisCompilation: ['NoDangerNamePlugin'],
        environment: ['WebExtensionPlugin']
      },
      workerEntry: 'background/service_worker',
      publicPath: '',
      entry: {}
    })
  })

  // Dev registers the same target through SetupReloadStrategy. Applying both
  // would install the runtime module twice.
  it('stays out of the way in development, where the reload strategy owns it', () => {
    const {manifestPath} = project({'manifest.json': manifest})

    expect(installed(manifestPath, 'development').taps).toEqual({})
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
    expect(result.workerEntry).toBeUndefined()
    expect(result.publicPath).toBe('')
  })

  // Regression: a cross-browser MV3 manifest with Firefox-style
  // background.scripts bundles as the background/scripts entry on Chromium.
  // Naming background/service_worker here made the fork assert at entryOption
  // and hard-crash every production build of such a manifest.
  it('resolves a background.scripts manifest to the background/scripts entry', () => {
    const {manifestPath} = project({
      'manifest.json': {
        manifest_version: 3,
        name: 'scripts background',
        version: '1.0',
        background: {scripts: ['background.js']},
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      },
      'background.js': ''
    })

    expect(installed(manifestPath, 'production').workerEntry).toBe(
      'background/scripts'
    )
  })

  // Regression: a service_worker path that resolves to no file produces no
  // entry, and naming one crashed the build with the fork's entryOption throw
  // before the curated ScriptsMissingFile diagnostic could surface.
  it('omits the service worker entry when its file does not exist', () => {
    const {manifestPath} = project({
      'manifest.json': {
        manifest_version: 3,
        name: 'missing worker',
        version: '1.0',
        background: {service_worker: 'background/missing.js'}
      }
    })
    const result = installed(manifestPath, 'production')

    expect(result.workerEntry).toBeUndefined()
    expect(result.publicPath).toBe('')
  })
})

describe('SetupChunkLoadingTarget in a production compile', () => {
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
