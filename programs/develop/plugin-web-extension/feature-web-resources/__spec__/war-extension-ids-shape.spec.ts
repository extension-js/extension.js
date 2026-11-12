import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

describe('web_accessible_resources: a group with no matches key', () => {
  let tmpRoot: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-ids-'))
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    fs.mkdirSync(path.join(tmpRoot, 'dist', 'img'), {recursive: true})
    fs.writeFileSync(path.join(tmpRoot, 'dist', 'img', 'a.png'), 'x')
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  function written(groups: unknown[]) {
    const manifest = {manifest_version: 3, web_accessible_resources: groups}
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const updateAsset = vi.fn()
    const compilation: any = {
      getAsset: vi.fn(() => ({name: 'manifest.json', source: manifestSource})),
      assets: {'manifest.json': manifestSource},
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development'}
    }

    generateManifestPatches(compilation as Compilation, manifestPath, {})

    const source = updateAsset.mock.calls.at(-1)?.[1]

    return JSON.parse(String(source.source())).web_accessible_resources
  }

  it('writes an extension_ids group back with no matches key', () => {
    expect(
      written([{resources: ['/img/a.png'], extension_ids: ['abc']}])
    ).toEqual([{resources: ['img/a.png'], extension_ids: ['abc']}])
  })

  it('keeps an empty matches array the author wrote', () => {
    expect(
      written([
        {resources: ['/img/a.png'], matches: [], extension_ids: ['abc']}
      ])
    ).toEqual([{resources: ['img/a.png'], matches: [], extension_ids: ['abc']}])
  })
})
