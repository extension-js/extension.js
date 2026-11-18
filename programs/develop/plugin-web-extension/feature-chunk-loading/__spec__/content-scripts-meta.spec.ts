import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {buildContentScriptsMeta} from '../content-scripts-meta'

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
