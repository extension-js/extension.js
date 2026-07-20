import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {PruneStaleHotUpdates} from '../steps/prune-stale-hot-updates'

describe('PruneStaleHotUpdates (bug 34)', () => {
  let tmp: string
  let hotDir: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-hot-'))
    hotDir = path.join(tmp, 'hot')
    fs.mkdirSync(hotDir, {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  function makeHarness() {
    let doneFn: ((stats: unknown) => void) | undefined
    const compiler = {
      options: {output: {path: tmp}},
      hooks: {
        done: {
          tap: (_name: string, fn: (stats: unknown) => void) => {
            doneFn = fn
          }
        }
      }
    }
    new PruneStaleHotUpdates().apply(compiler as any)
    const compileWith = (assetNames: string[]) => {
      doneFn!({
        compilation: {
          getAssets: () => assetNames.map((name) => ({name}))
        }
      })
    }
    return {compileWith}
  }

  const touch = (...names: string[]) => {
    for (const name of names) fs.writeFileSync(path.join(hotDir, name), '')
  }

  const hotFiles = () => fs.readdirSync(hotDir).sort()

  it('keeps the current and previous generation, prunes older ones', () => {
    const {compileWith} = makeHarness()

    touch('gen1.js', 'gen1.json', 'gen1.js.map')
    compileWith(['hot/gen1.js', 'hot/gen1.json', 'hot/gen1.js.map'])
    expect(hotFiles()).toEqual(['gen1.js', 'gen1.js.map', 'gen1.json'])

    touch('gen2.js', 'gen2.json')
    compileWith(['hot/gen2.js', 'hot/gen2.json', 'main.js'])
    // gen1 is the previous generation: kept one round as a grace window
    expect(hotFiles()).toEqual([
      'gen1.js',
      'gen1.js.map',
      'gen1.json',
      'gen2.js',
      'gen2.json'
    ])

    touch('gen3.js', 'gen3.json')
    compileWith(['hot/gen3.js', 'hot/gen3.json'])
    // gen1 is now two generations old: pruned
    expect(hotFiles()).toEqual(['gen2.js', 'gen2.json', 'gen3.js', 'gen3.json'])
  })

  it("prunes a prior session's leftovers on the first compile", () => {
    touch('stale-a.js', 'stale-b.json')
    const {compileWith} = makeHarness()

    touch('fresh.js')
    compileWith(['hot/fresh.js'])
    expect(hotFiles()).toEqual(['fresh.js'])
  })

  it('prunes nested runtime-named update manifests too', () => {
    const {compileWith} = makeHarness()
    const nested = path.join(hotDir, 'background')
    fs.mkdirSync(nested, {recursive: true})

    fs.writeFileSync(path.join(nested, 'service_worker.aaa.json'), '')
    compileWith(['hot/background/service_worker.aaa.json'])

    fs.writeFileSync(path.join(nested, 'service_worker.bbb.json'), '')
    compileWith(['hot/background/service_worker.bbb.json'])

    fs.writeFileSync(path.join(nested, 'service_worker.ccc.json'), '')
    compileWith(['hot/background/service_worker.ccc.json'])

    // aaa is two generations old: pruned; bbb kept as grace window
    expect(fs.readdirSync(nested).sort()).toEqual([
      'service_worker.bbb.json',
      'service_worker.ccc.json'
    ])
  })

  it('removes directories that become empty after pruning', () => {
    const {compileWith} = makeHarness()
    const nested = path.join(hotDir, 'content_scripts')
    fs.mkdirSync(nested, {recursive: true})
    fs.writeFileSync(path.join(nested, 'content-0.old.json'), '')

    compileWith(['hot/gen.js'])
    touch('gen.js')
    compileWith(['hot/gen.js'])

    expect(fs.existsSync(nested)).toBe(false)
  })

  it('is a no-op when the hot dir does not exist', () => {
    fs.rmSync(hotDir, {recursive: true, force: true})
    const {compileWith} = makeHarness()
    expect(() => compileWith(['main.js'])).not.toThrow()
  })
})
