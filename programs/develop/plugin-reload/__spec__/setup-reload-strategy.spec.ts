import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  compileFiles,
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {SetupReloadStrategy} from '../steps/setup-reload-strategy/index'

const makeTempFolder = trackTempFolders()

// Applies the strategy to an idle dev compiler over a real manifest and
// reads back the taps and the entries it added.
function run(
  manifest: object,
  options: {browser?: string; files?: string[]} = {}
) {
  const root = makeTempFolder('extjs-reload-strategy-')
  writeProject(root, {
    'manifest.json': manifest,
    ...Object.fromEntries((options.files ?? []).map((file) => [file, '']))
  })

  const compiler = idleCompiler(root, 'development')
  const taps = tapsAddedBy(compiler, () =>
    new SetupReloadStrategy({
      manifestPath: path.join(root, 'manifest.json'),
      ...(options.browser ? {browser: options.browser} : {})
    } as ConstructorParameters<typeof SetupReloadStrategy>[0]).apply(compiler)
  )
  const entry = compiler.options.entry as Record<string, {import: string[]}>

  return {
    root,
    taps,
    entries: Object.fromEntries(
      Object.entries(entry).map(([name, value]) => [
        name,
        value.import.map((file) => path.basename(file).replace(/\..*$/, ''))
      ])
    )
  }
}

// The background bundles that answer a content script asking for a chunk,
// read off a real dev compile of the entries the scripts feature creates.
async function fallbackListeners(
  manifest: object,
  entry: Record<string, string>
): Promise<string[]> {
  const root = writeProject(makeTempFolder('extjs-reload-strategy-'), {
    'manifest.json': manifest,
    'b.js': ''
  })
  const {errors, files} = await compileFiles(
    root,
    entry,
    new SetupReloadStrategy({
      manifestPath: path.join(root, 'manifest.json'),
      browser: 'chrome'
    } as ConstructorParameters<typeof SetupReloadStrategy>[0]),
    'development'
  )

  expect(errors).toEqual([])

  return Object.keys(files).filter((name) =>
    files[name].includes('type != "WTW_INJECT"')
  )
}

// The exact option objects per manifest shape are pinned in
// get-background-entry-name.spec.ts, this file checks what a compile gets.
describe('SetupReloadStrategy background entry', () => {
  it('uses a service worker entry for MV3 on chromium', async () => {
    const manifest = {manifest_version: 3, background: {service_worker: 'b.js'}}

    expect(run(manifest, {files: ['b.js']}).entries).toEqual({
      'background/service_worker': ['b']
    })

    expect(
      await fallbackListeners(manifest, {'background/service_worker': 'b.js'})
    ).toEqual(['background/service_worker.js'])
  })

  // Chromium runs a Firefox-style MV3 background.scripts bundle as a worker
  // under the background/scripts entry, so the fallback is answered there.
  it('uses the background/scripts entry for MV3 background.scripts on chromium', async () => {
    expect(
      await fallbackListeners(
        {manifest_version: 3, background: {scripts: ['b.js']}},
        {'background/scripts': 'b.js'}
      )
    ).toEqual(['background/scripts.js'])
  })

  // A missing file produces no entry at all, and the missing-file error is
  // the one report the build gets.
  it('adds no worker entry when the declared background file is missing', () => {
    const result = run({
      manifest_version: 3,
      background: {service_worker: 'b.js'}
    })

    expect(result.entries).toEqual({})
    expect(result.taps.thisCompilation).toContain(
      'plugin-reload:setup-background-entry'
    )
  })

  it('uses a page entry for MV2 on chromium', () => {
    const result = run(
      {manifest_version: 2, background: {scripts: ['b.js']}},
      {files: ['b.js']}
    )

    expect(result.taps.compilation).toContain('ChunkLoaderRuntime')
  })

  it('uses a page entry on gecko even when the manifest is MV3', () => {
    const result = run(
      {manifest_version: 3, background: {service_worker: 'b.js'}},
      {browser: 'firefox', files: ['b.js']}
    )

    expect(result.taps.compilation).toContain('ChunkLoaderRuntime')
  })

  it('adds the minimum worker as an entry when the manifest declares none', () => {
    const result = run({manifest_version: 3})

    expect(result.entries).toEqual({
      'background/service_worker': ['minimum-chromium-file']
    })
  })
})

describe('SetupReloadStrategy wiring', () => {
  it('hands the browser to the background entry step', () => {
    expect(run({manifest_version: 3}, {browser: 'firefox'}).entries).toEqual({
      'background/script': ['minimum-firefox-file']
    })
  })

  it('defaults the browser to chrome', () => {
    expect(run({manifest_version: 3}).entries).toEqual({
      'background/service_worker': ['minimum-chromium-file']
    })
  })
})

describe('SetupReloadStrategy in a development compile', () => {
  // The loader a lazy chunk gets depends on the world the strategy hands the
  // chunk loader, so a MAIN world script must come out with the bridge loader.
  it('hands the content script worlds to the chunk loader', async () => {
    const lazyImport = "import('./lazy.js').then((m) => console.log(m))\n"
    const root = writeProject(makeTempFolder('extjs-reload-strategy-'), {
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
      new SetupReloadStrategy({
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome'
      } as ConstructorParameters<typeof SetupReloadStrategy>[0]),
      'development'
    )

    expect(errors).toEqual([])
    expect(files['content_scripts/content-0.js']).not.toContain(
      'EXTJS_WTW_LOAD'
    )

    expect(files['content_scripts/content-1.js']).toContain('EXTJS_WTW_LOAD')
  })
})
