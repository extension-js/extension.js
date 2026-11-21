import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {buildContentScriptsMeta} from '../../feature-chunk-loading/content-scripts-meta'
import {contentScripts} from '../../feature-manifest/manifest-overrides/common/content_scripts'
import {parseCanonicalContentScriptAsset} from '../contracts'
import {getMainWorldBridgePairs} from '../steps/add-content-script-wrapper/get-bridge-scripts'

// Three readers place the bridge of each MAIN world group: the build here,
// the emitted manifest and the chunk loader. Each is read as main -> bridge.
type Pairs = Array<[number, number]>

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function fromBuild(manifest: Manifest): Pairs {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-bridge-index-'))
  roots.push(root)

  const manifestPath = path.join(root, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))

  return getMainWorldBridgePairs(manifestPath, 'chrome').map(
    ({mainIndex, bridgeIndex}) => [mainIndex, bridgeIndex]
  )
}

const indexOf = (asset: unknown) =>
  parseCanonicalContentScriptAsset(String(asset))?.index ?? -1

function fromManifest(manifest: Manifest): Pairs {
  const emitted = (contentScripts(manifest)?.content_scripts || []) as Array<{
    world?: string
    js?: string[]
    css?: string[]
  }>

  // A bridge is emitted right before the group it serves.
  return emitted.flatMap((group, at): Pairs => {
    if (group.world !== 'MAIN') return []

    const own = group.js?.[0] ?? group.css?.[0]

    return [[indexOf(own), indexOf(emitted[at - 1]?.js?.[0])]]
  })
}

function fromReload(manifest: Manifest): Pairs {
  return Object.values(buildContentScriptsMeta(manifest))
    .filter((meta) => meta.role === 'main_world_bridge')
    .map((meta): [number, number] => [
      indexOf(meta.mainBundleId),
      meta.index as number
    ])
}

const isolated = (n: number) => ({matches: ['<all_urls>'], js: [`i${n}.js`]})
const main = (n: number) => ({...isolated(n), world: 'MAIN'})

// Every declared count from one to four, with every set of MAIN positions.
const matrix = [1, 2, 3, 4].flatMap((count) =>
  Array.from({length: 2 ** count}, (_, mask) => ({
    count,
    mains: Array.from({length: count}, (_, i) => i).filter(
      (i) => mask & (1 << i)
    )
  }))
)

describe('the bridge index rule', () => {
  it('places every bridge at the declared count plus its ordinal in all three', () => {
    for (const {count, mains} of matrix) {
      const manifest = {
        manifest_version: 3,
        content_scripts: Array.from({length: count}, (_, i) =>
          mains.includes(i) ? main(i) : isolated(i)
        )
      } as unknown as Manifest
      const expected: Pairs = mains.map((at, ordinal) => [at, count + ordinal])
      const label = `${count} groups, MAIN at [${mains}]`

      expect(fromBuild(manifest), label).toEqual(expected)
      expect(fromManifest(manifest), label).toEqual(expected)
      expect(fromReload(manifest), label).toEqual(expected)
    }

    expect(matrix).toHaveLength(30)
  })

  // A group prefixed for another browser is left with no file here. The
  // manifest declares no bridge for it, so no owner may count it.
  it('skips a MAIN world group left with no file for this browser in all three', () => {
    const manifest = {
      manifest_version: 3,
      content_scripts: [
        isolated(0),
        {matches: ['<all_urls>'], world: 'MAIN'},
        main(2)
      ]
    } as unknown as Manifest

    expect(fromManifest(manifest)).toEqual([[2, 3]])
    expect(fromBuild(manifest)).toEqual([[2, 3]])
    expect(fromReload(manifest)).toEqual([[2, 3]])
  })

  it('skips the empty group the same way when it was scoped to another browser', () => {
    const manifest = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], world: 'MAIN', 'firefox:js': ['f.js']},
        main(1)
      ]
    } as unknown as Manifest

    expect(fromBuild(manifest)).toEqual([[1, 2]])
  })
})
