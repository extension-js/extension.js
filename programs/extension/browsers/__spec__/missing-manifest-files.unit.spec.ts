import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {findMissingManifestFiles} from '../run-chromium/manifest-readiness'

describe('findMissingManifestFiles', () => {
  let outPath: string

  beforeEach(() => {
    outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-files-'))
  })

  afterEach(() => {
    fs.rmSync(outPath, {recursive: true, force: true})
  })

  const writeManifest = (manifest: Record<string, unknown>) => {
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify(manifest)
    )
  }

  const touch = (relativePath: string) => {
    const absolute = path.join(outPath, relativePath)
    fs.mkdirSync(path.dirname(absolute), {recursive: true})
    fs.writeFileSync(absolute, '')
  }

  it('names a declared service worker that was never emitted', () => {
    writeManifest({
      manifest_version: 3,
      background: {service_worker: 'background/service_worker.js'}
    })

    expect(findMissingManifestFiles(outPath)).toEqual([
      'background/service_worker.js'
    ])
  })

  it('returns nothing when every declared file is on disk', () => {
    writeManifest({
      manifest_version: 3,
      background: {service_worker: 'background/service_worker.js'},
      content_scripts: [{js: ['content_scripts/content-0.js']}]
    })

    touch('background/service_worker.js')
    touch('content_scripts/content-0.js')

    expect(findMissingManifestFiles(outPath)).toEqual([])
  })

  it('names content script and side panel files too', () => {
    writeManifest({
      manifest_version: 3,
      side_panel: {default_path: 'sidebar/index.html'},
      content_scripts: [{js: ['content_scripts/content-0.js'], css: []}]
    })

    expect(findMissingManifestFiles(outPath).sort()).toEqual([
      'content_scripts/content-0.js',
      'sidebar/index.html'
    ])
  })

  it('returns nothing when there is no readable manifest', () => {
    expect(findMissingManifestFiles(outPath)).toEqual([])

    fs.writeFileSync(path.join(outPath, 'manifest.json'), '{ not json')
    expect(findMissingManifestFiles(outPath)).toEqual([])
  })

  it('reads a page path up to its fragment or query', () => {
    writeManifest({
      manifest_version: 3,
      side_panel: {default_path: 'panel.html#home'},
      background: {service_worker: 'sw.js'}
    })

    touch('sw.js')
    expect(findMissingManifestFiles(outPath)).toEqual(['panel.html'])

    touch('panel.html')
    expect(findMissingManifestFiles(outPath)).toEqual([])

    writeManifest({
      manifest_version: 2,
      background: {page: 'bg.html?mode=dev#top'}
    })

    expect(findMissingManifestFiles(outPath)).toEqual(['bg.html'])
  })

  it('judges only the background keys the target engine reads', () => {
    writeManifest({
      manifest_version: 3,
      background: {service_worker: 'sw.js', scripts: ['bg-firefox.js']}
    })

    touch('sw.js')
    expect(findMissingManifestFiles(outPath)).toEqual([])
    expect(findMissingManifestFiles(outPath, 'gecko')).toEqual([
      'bg-firefox.js'
    ])

    fs.rmSync(path.join(outPath, 'sw.js'))
    touch('bg-firefox.js')
    expect(findMissingManifestFiles(outPath)).toEqual(['sw.js'])
    expect(findMissingManifestFiles(outPath, 'gecko')).toEqual([])
  })

  it('still names the background scripts of a manifest version 2 build', () => {
    writeManifest({manifest_version: 2, background: {scripts: ['bg.js']}})

    expect(findMissingManifestFiles(outPath)).toEqual(['bg.js'])
    expect(findMissingManifestFiles(outPath, 'gecko')).toEqual(['bg.js'])
  })
})
