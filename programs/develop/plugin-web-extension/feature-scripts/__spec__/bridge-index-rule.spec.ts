import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {buildContentScriptsMeta} from '../../../plugin-reload/steps/setup-reload-strategy'
import type {Manifest} from '../../../types'
import {contentScripts} from '../../feature-manifest/manifest-overrides/common/content_scripts'
import {parseCanonicalContentScriptAsset} from '../contracts'
import {getMainWorldBridgePairs} from '../steps/add-content-script-wrapper/get-bridge-scripts'

// Three owners place the bridge of each MAIN world group: the build here,
// the emitted manifest and the reload strategy. Each is read as main -> bridge.
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
    .filter((meta: any) => meta.role === 'main_world_bridge')
    .map((meta: any): [number, number] => [
      indexOf(meta.mainBundleId),
      meta.index
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

describe('the bridge index rule, written three times', () => {
  it('places every bridge at the declared count plus its ordinal in all three', () => {
    // Pins today's behavior.
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

  it('disagrees on a MAIN world group left with no file for this browser', () => {
    // Pins today's behavior.
    const manifest = {
      manifest_version: 3,
      content_scripts: [
        isolated(0),
        {matches: ['<all_urls>'], world: 'MAIN'},
        main(2)
      ]
    } as unknown as Manifest

    // The build and the reload strategy count the empty group, the manifest
    // skips it, so the declared bridge points one slot lower.
    expect(fromBuild(manifest)).toEqual([
      [1, 3],
      [2, 4]
    ])

    expect(fromReload(manifest)).toEqual([
      [1, 3],
      [2, 4]
    ])

    expect(fromManifest(manifest)).toEqual([[2, 3]])
  })
})
