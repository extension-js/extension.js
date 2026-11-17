import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import type {Manifest} from '../../types'
import {
  buildContentScriptsMeta,
  SetupReloadStrategy
} from '../steps/setup-reload-strategy/index'
import {
  idleCompiler,
  tapsAddedBy,
  workerEntryFromFork,
  writeProject
} from './helpers/real-compiler'

const makeTempFolder = trackTempFolders()

// Applies the strategy to an idle dev compiler over a real manifest and
// reads back the worker entry the fork claims and the entries it added.
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
    workerEntry: workerEntryFromFork(compiler),
    entries: Object.fromEntries(
      Object.entries(entry).map(([name, value]) => [
        name,
        value.import.map((file) => path.basename(file).replace(/\..*$/, ''))
      ])
    )
  }
}

// The exact option objects per manifest shape are pinned in
// get-background-entry-name.spec.ts, this file checks what reaches the fork.
describe('SetupReloadStrategy background entry', () => {
  it('uses a service worker entry for MV3 on chromium', () => {
    const result = run(
      {manifest_version: 3, background: {service_worker: 'b.js'}},
      {files: ['b.js']}
    )

    expect(result.workerEntry).toBe('background/service_worker')
    expect(result.entries).toEqual({'background/service_worker': ['b']})
  })

  // Chromium runs a Firefox-style MV3 background.scripts bundle as a worker
  // under the background/scripts entry. Naming background/service_worker here
  // crashed production builds, where no such entry is ever synthesized.
  it('uses the background/scripts entry for MV3 background.scripts on chromium', () => {
    expect(
      run(
        {manifest_version: 3, background: {scripts: ['b.js']}},
        {files: ['b.js']}
      ).workerEntry
    ).toBe('background/scripts')
  })

  // A missing file produces no entry at all, and naming one trips the fork's
  // entryOption assert before the curated missing-file error can surface.
  it('omits the worker entry when the declared background file is missing', () => {
    const result = run({
      manifest_version: 3,
      background: {service_worker: 'b.js'}
    })

    expect(result.workerEntry).toBeUndefined()
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

    expect(result.workerEntry).toBeUndefined()
    expect(result.taps.compilation).toContain(
      'WebExtensionChuckLoaderRuntimePlugin'
    )
  })

  it('uses a page entry on gecko even when the manifest is MV3', () => {
    const result = run(
      {manifest_version: 3, background: {service_worker: 'b.js'}},
      {browser: 'firefox', files: ['b.js']}
    )

    expect(result.workerEntry).toBeUndefined()
    expect(result.taps.compilation).toContain(
      'WebExtensionChuckLoaderRuntimePlugin'
    )
  })

  // The minimum worker is added as an entry, and the fork still names none.
  it('falls back to a plain background entry when the manifest declares none', () => {
    const result = run({manifest_version: 3})

    expect(result.workerEntry).toBeUndefined()
    expect(result.entries).toEqual({
      'background/service_worker': ['minimum-chromium-file']
    })
  })
})

describe('buildContentScriptsMeta', () => {
  const meta = (contentScripts: unknown) =>
    buildContentScriptsMeta({
      manifest_version: 3,
      content_scripts: contentScripts
    } as Manifest)

  it('is empty when the manifest declares no content scripts', () => {
    expect(buildContentScriptsMeta({manifest_version: 3} as Manifest)).toEqual(
      {}
    )
  })

  it('maps each ordinary content script to the extension world', () => {
    expect(
      meta([{matches: ['<all_urls>']}, {matches: ['<all_urls>']}])
    ).toEqual({
      'content_scripts/content-0.js': {
        index: 0,
        bundleId: 'content_scripts/content-0.js',
        world: 'extension'
      },
      'content_scripts/content-1.js': {
        index: 1,
        bundleId: 'content_scripts/content-1.js',
        world: 'extension'
      }
    })
  })

  it('pairs a MAIN world script with a bridge indexed past the original count', () => {
    expect(
      meta([
        {matches: ['<all_urls>'], world: 'MAIN'},
        {matches: ['<all_urls>']}
      ])
    ).toEqual({
      'content_scripts/content-0.js': {
        index: 0,
        bundleId: 'content_scripts/content-0.js',
        world: 'main',
        bridgeBundleId: 'content_scripts/content-2.js'
      },
      'content_scripts/content-2.js': {
        index: 2,
        bundleId: 'content_scripts/content-2.js',
        world: 'extension',
        role: 'main_world_bridge',
        mainBundleId: 'content_scripts/content-0.js'
      },
      'content_scripts/content-1.js': {
        index: 1,
        bundleId: 'content_scripts/content-1.js',
        world: 'extension'
      }
    })
  })

  it('gives each MAIN world script its own bridge', () => {
    const result = meta([
      {matches: ['<all_urls>'], world: 'MAIN'},
      {matches: ['<all_urls>'], world: 'MAIN'}
    ])

    expect(result['content_scripts/content-0.js']).toMatchObject({
      bridgeBundleId: 'content_scripts/content-2.js'
    })

    expect(result['content_scripts/content-1.js']).toMatchObject({
      bridgeBundleId: 'content_scripts/content-3.js'
    })

    expect(result['content_scripts/content-3.js']).toMatchObject({
      mainBundleId: 'content_scripts/content-1.js'
    })
  })

  it('survives a malformed content_scripts value instead of failing the build', () => {
    expect(meta('not-an-array')).toEqual({})
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
