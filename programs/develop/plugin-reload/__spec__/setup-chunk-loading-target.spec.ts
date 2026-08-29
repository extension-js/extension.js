import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

const webExtensionCtor = vi.hoisted(() =>
  vi.fn(function (this: any, options: any) {
    this.options = options
    this.apply = () => {}
  })
)
vi.mock(
  '../steps/setup-reload-strategy/webpack-target-webextension-fork',
  () => ({default: webExtensionCtor})
)

import {SetupChunkLoadingTarget} from '../steps/setup-chunk-loading-target'

const tempDirs: string[] = []

afterEach(() => {
  webExtensionCtor.mockClear()
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function writeManifest(manifest: unknown, files: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-chunk-target-'))
  tempDirs.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
  for (const file of files) {
    const filePath = path.join(dir, file)
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, '// stub', 'utf8')
  }
  return manifestPath
}

function makeCompiler(mode: 'development' | 'production') {
  return {options: {mode}} as any
}

// Regression for issue #507: a dynamic import() in a content script worked in
// `extension dev` and died with ChunkLoadError in `extension build`. The
// web-extension chunk-loading target was only ever registered by ReloadPlugin,
// which returns early in production, so a production build fell back to
// rspack's web target. That loader appends a <script> to the host document,
// which runs in the MAIN world while the content script lives in the isolated
// world, so the chunk never reaches the requester.
describe('SetupChunkLoadingTarget', () => {
  const manifest = {
    manifest_version: 3,
    name: 'chunk target',
    version: '1.0',
    background: {service_worker: 'background/index.js'},
    content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
  }

  it('installs the web-extension target for a production build', () => {
    const manifestPath = writeManifest(manifest, ['background/index.js'])

    new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'}).apply(
      makeCompiler('production')
    )

    expect(webExtensionCtor).toHaveBeenCalledTimes(1)
    const options = webExtensionCtor.mock.calls[0][0] as any
    expect(options.hmrConfig).toBe(false)
    expect(options.background.serviceWorkerEntry).toBe(
      'background/service_worker'
    )
    // Regression: the classic loader adds a background runtime module that
    // lands bare at the top of a production service worker, which has no
    // webpack runtime to scope it, and the worker then dies on load with
    // `__webpack_require__ is not defined`. The reader is
    // `background.classicLoader`, so a top-level key is silently ignored.
    expect(options.background.classicLoader).toBe(false)
    expect(options.contentScriptsMeta['content_scripts/content-0.js']).toEqual({
      index: 0,
      bundleId: 'content_scripts/content-0.js',
      world: 'extension'
    })
  })

  // Dev registers the same target through SetupReloadStrategy. Applying both
  // would install the runtime module twice.
  it('stays out of the way in development, where the reload strategy owns it', () => {
    const manifestPath = writeManifest(manifest)

    new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'}).apply(
      makeCompiler('development')
    )

    expect(webExtensionCtor).not.toHaveBeenCalled()
  })

  it('marks a MAIN world content script so the loader can pick its bridge', () => {
    const manifestPath = writeManifest({
      ...manifest,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
      ]
    })

    new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'}).apply(
      makeCompiler('production')
    )

    const meta = (webExtensionCtor.mock.calls[0][0] as any).contentScriptsMeta
    expect(meta['content_scripts/content-0.js'].world).toBe('main')
    expect(meta['content_scripts/content-0.js'].bridgeBundleId).toBe(
      'content_scripts/content-1.js'
    )
  })

  it('never runs without a readable manifest', () => {
    new SetupChunkLoadingTarget({
      manifestPath: path.join(os.tmpdir(), 'extjs-nope', 'manifest.json'),
      browser: 'chrome'
    }).apply(makeCompiler('production'))

    expect(webExtensionCtor).not.toHaveBeenCalled()
  })

  it('never synthesizes a background entry the author did not write', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'no background',
      version: '1.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
    const compiler = makeCompiler('production')
    compiler.options.entry = {}

    new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'}).apply(
      compiler
    )

    expect(compiler.options.entry).toEqual({})
    expect(
      (webExtensionCtor.mock.calls[0][0] as any).background.serviceWorkerEntry
    ).toBeUndefined()
  })

  // Regression: a cross-browser MV3 manifest with Firefox-style
  // background.scripts bundles as the background/scripts entry on Chromium.
  // Naming background/service_worker here made the fork assert at entryOption
  // and hard-crash every production build of such a manifest.
  it('resolves a background.scripts manifest to the background/scripts entry', () => {
    const manifestPath = writeManifest(
      {
        manifest_version: 3,
        name: 'scripts background',
        version: '1.0',
        background: {scripts: ['background.js']},
        content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
      },
      ['background.js']
    )

    new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'}).apply(
      makeCompiler('production')
    )

    const options = webExtensionCtor.mock.calls[0][0] as any
    expect(options.background.serviceWorkerEntry).toBe('background/scripts')
  })

  // Regression: a service_worker path that resolves to no file produces no
  // entry, and naming one crashed the build with the fork's entryOption throw
  // before the curated ScriptsMissingFile diagnostic could surface.
  it('omits the service worker entry when its file does not exist', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'missing worker',
      version: '1.0',
      background: {service_worker: 'background/missing.js'}
    })

    new SetupChunkLoadingTarget({manifestPath, browser: 'chrome'}).apply(
      makeCompiler('production')
    )

    const options = webExtensionCtor.mock.calls[0][0] as any
    expect(options.background.serviceWorkerEntry).toBeUndefined()
    expect(options.background.pageEntry).toBeUndefined()
  })
})
