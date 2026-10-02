import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

describe('web_accessible_resources: files a content-script stylesheet names', () => {
  let tmpRoot: string
  let outputPath: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-css-url-'))
    outputPath = path.join(tmpRoot, 'dist', 'chromium')
    fs.mkdirSync(path.join(outputPath, 'content_scripts'), {recursive: true})
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function run(css: string, extraAssets: string[]) {
    const cssKey = 'content_scripts/content-0.css'
    const manifest = {
      manifest_version: 3,
      content_scripts: [
        {
          matches: ['https://e.com/*'],
          js: ['content_scripts/content-0.js'],
          css: [cssKey]
        }
      ]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const updateAsset = vi.fn()
    const assets: Record<string, {source: () => string}> = {
      'manifest.json': manifestSource,
      [cssKey]: {source: () => css},
      'content_scripts/content-0.js': {source: () => ''}
    }

    for (const key of extraAssets) {
      assets[key] = {source: () => 'binary'}
    }

    const compilation: any = {
      getAsset: vi.fn((name: string) =>
        name === 'manifest.json'
          ? {name: 'manifest.json', source: manifestSource}
          : assets[name]
            ? {name, source: assets[name]}
            : undefined
      ),
      assets,
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'production', output: {path: outputPath}}
    }

    generateManifestPatches(compilation as Compilation, manifestPath, {})

    const patched = JSON.parse(updateAsset.mock.calls[0][1].source().toString())

    return (patched.web_accessible_resources || []).flatMap(
      (group: {resources: string[]}) => group.resources
    ) as string[]
  }

  // Chrome blocks a resource a page loads unless it is web-accessible, so an
  // image a content script's CSS reaches never paints without a WAR entry.
  it('exposes an image, a media file and a font the same way', () => {
    const resources = run(
      `body{background-image:url('/img/bg.png')}
       .a{background:url("/data/x.gif")}
       .b{background:url(/img/bg.webp)}
       @font-face{font-family:T;src:url('/fonts/f.woff2')}`,
      ['img/bg.png', 'data/x.gif', 'img/bg.webp', 'fonts/f.woff2']
    )

    expect(resources).toContain('img/bg.png')
    expect(resources).toContain('data/x.gif')
    expect(resources).toContain('img/bg.webp')
    expect(resources).toContain('fonts/f.woff2')
  })

  it('leaves an emitted file the stylesheet never names alone', () => {
    const resources = run(`body{background-image:url('/img/bg.png')}`, [
      'img/bg.png',
      'img/unreferenced.png'
    ])

    expect(resources).toContain('img/bg.png')
    expect(resources).not.toContain('img/unreferenced.png')
  })

  it('ignores data, absolute and protocol-relative urls', () => {
    const resources = run(
      `.a{background:url('data:image/png;base64,AAA')}
       .b{background:url('https://cdn.test/x.png')}
       .c{background:url('//cdn.test/y.png')}`,
      ['img/bg.png']
    )

    expect(resources).not.toContain('img/bg.png')
  })

  it('resolves a url relative to the stylesheet folder', () => {
    const resources = run(`body{background-image:url('./near.png')}`, [
      'content_scripts/near.png'
    ])

    expect(resources).toContain('content_scripts/near.png')
  })

  it('drops a query string and a fragment before matching', () => {
    const resources = run(
      `body{background-image:url('/img/bg.png?v=2')}
       .a{background:url('/img/bg.webp#frag')}`,
      ['img/bg.png', 'img/bg.webp']
    )

    expect(resources).toContain('img/bg.png')
    expect(resources).toContain('img/bg.webp')
  })
})
