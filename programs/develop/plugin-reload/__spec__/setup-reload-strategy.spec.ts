import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  compileFiles,
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {SetupChunkLoadingTarget} from '../../plugin-web-extension/feature-chunk-loading'
import {
  type ChunkLoadingBackgroundEntries,
  chunkLoadingTargetExtensionsFor
} from '../../plugin-web-extension/shared/chunk-loading-target-extensions'
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
  const [extension] = chunkLoadingTargetExtensionsFor(compiler)

  return {
    root,
    taps,
    // The background the session asks the chunk loading target to answer
    // the message fallback from, given the one the manifest names.
    fallback: (authored: ChunkLoadingBackgroundEntries) =>
      extension?.fallbackBackground(authored),
    entries: Object.fromEntries(
      Object.entries(entry).map(([name, value]) => [
        name,
        value.import.map((file) => path.basename(file).replace(/\..*$/, ''))
      ])
    )
  }
}

// The background bundles that answer a content script asking for a chunk,
// read off a real dev compile of the entries the scripts feature creates,
// with the chunk loading target applied after the strategy.
async function fallbackListeners(
  manifest: object,
  entry: Record<string, string>,
  browser = 'chrome'
): Promise<string[]> {
  const root = writeProject(makeTempFolder('extjs-reload-strategy-'), {
    'manifest.json': manifest,
    'b.js': ''
  })
  const manifestPath = path.join(root, 'manifest.json')
  // The same order the build config applies the two plugins in.
  const {errors, files} = await compileFiles(
    root,
    entry,
    {
      apply(compiler) {
        new SetupReloadStrategy({
          manifestPath,
          browser
        } as ConstructorParameters<typeof SetupReloadStrategy>[0]).apply(
          compiler
        )

        new SetupChunkLoadingTarget({
          manifestPath,
          browser
        } as ConstructorParameters<typeof SetupChunkLoadingTarget>[0]).apply(
          compiler
        )
      }
    },
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

  // The session also generates a worker for this manifest, and Chromium
  // runs the authored bundle, so the generated one gets no listener.
  it('answers from the authored bundle beside a worker the session generated', async () => {
    const manifest = {manifest_version: 3, background: {scripts: ['b.js']}}

    expect(Object.keys(run(manifest, {files: ['b.js']}).entries)).toEqual([
      'background/service_worker'
    ])

    expect(
      await fallbackListeners(manifest, {'background/scripts': 'b.js'})
    ).toEqual(['background/scripts.js'])
  })

  // The scripts feature bundles background.scripts under background/scripts
  // on every browser, so that is the entry a page background answers from.
  it('answers from background/scripts for an authored Firefox background', async () => {
    expect(
      await fallbackListeners(
        {manifest_version: 3, background: {scripts: ['b.js']}},
        {'background/scripts': 'b.js'},
        'firefox'
      )
    ).toEqual(['background/scripts.js'])
  })

  it('answers from background/scripts for an authored MV2 background', async () => {
    expect(
      await fallbackListeners(
        {manifest_version: 2, background: {scripts: ['b.js']}},
        {'background/scripts': 'b.js'}
      )
    ).toEqual(['background/scripts.js'])
  })

  it('answers from the background the session generated when none is authored', async () => {
    expect(await fallbackListeners({manifest_version: 3}, {})).toEqual([
      'background/service_worker.js'
    ])

    expect(
      await fallbackListeners({manifest_version: 3}, {}, 'firefox')
    ).toEqual(['background/script.js'])

    expect(await fallbackListeners({manifest_version: 2}, {})).toEqual([
      'background/script.js'
    ])
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

    expect(result.entries).toEqual({})
    expect(result.fallback({pageEntry: 'background/scripts'})).toEqual({
      pageEntry: 'background/scripts'
    })
  })

  // Gecko runs no service worker, so the target names none, and the session
  // answers from the background page it generated.
  it('uses a page entry on gecko even when the manifest is MV3', () => {
    const result = run(
      {manifest_version: 3, background: {service_worker: 'b.js'}},
      {browser: 'firefox', files: ['b.js']}
    )

    expect(result.fallback({})).toEqual({pageEntry: 'background/script'})
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

describe('SetupReloadStrategy hot update names', () => {
  // The names the build config gives hot update files before a session.
  function namedAfterStrategy() {
    const root = writeProject(makeTempFolder('extjs-reload-strategy-'), {
      'manifest.json': {manifest_version: 3}
    })
    const compiler = idleCompiler(root, 'development')
    compiler.options.output.hotUpdateChunkFilename =
      'hot/[id].[fullhash].hot-update.js'

    compiler.options.output.hotUpdateMainFilename =
      'hot/[runtime].[fullhash].hot-update.json'

    new SetupReloadStrategy({
      manifestPath: path.join(root, 'manifest.json')
    } as ConstructorParameters<typeof SetupReloadStrategy>[0]).apply(compiler)

    compiler.hooks.environment.call()

    return {
      chunk: compiler.options.output.hotUpdateChunkFilename,
      main: compiler.options.output.hotUpdateMainFilename
    }
  }

  it('writes hot update files under hot with no update suffix', () => {
    expect(namedAfterStrategy()).toEqual({
      chunk: 'hot/[id].[fullhash].js',
      main: 'hot/[runtime].[fullhash].json'
    })
  })
})
