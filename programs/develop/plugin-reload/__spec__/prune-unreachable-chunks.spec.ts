import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {PruneUnreachableChunks} from '../steps/prune-unreachable-chunks'

describe('PruneUnreachableChunks', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-chunks-'))
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
    new PruneUnreachableChunks().apply(compiler as any)

    const compileWith = (assetNames: string[], errors: unknown[] = []) => {
      doneFn!({
        compilation: {
          errors,
          getAssets: () => assetNames.map((name) => ({name}))
        }
      })
    }

    return {compileWith}
  }

  const touch = (...names: string[]) => {
    for (const name of names) {
      fs.mkdirSync(path.dirname(path.join(tmp, name)), {recursive: true})
      fs.writeFileSync(path.join(tmp, name), '')
    }
  }

  const rootFiles = () =>
    fs
      .readdirSync(tmp, {withFileTypes: true})
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()

  it('removes a root chunk and its map once no asset of the compile names it', () => {
    const {compileWith} = makeHarness()
    touch('436.js', '436.js.map', '512.js', 'manifest.json', 'vendor-7.js')

    compileWith(['512.js', 'manifest.json', 'background/service_worker.js'])
    expect(rootFiles()).toEqual(['512.js', 'manifest.json', 'vendor-7.js'])
  })

  it('keeps every file while the compile has errors', () => {
    const {compileWith} = makeHarness()
    touch('436.js', '436.js.map')

    compileWith(['manifest.json'], [new Error('unreachable-chunk-spec')])
    expect(rootFiles()).toEqual(['436.js', '436.js.map'])
  })

  it('leaves files inside folders alone', () => {
    const {compileWith} = makeHarness()
    touch('content_scripts/99.js', 'hot/12.js')

    compileWith(['manifest.json'])
    expect(fs.existsSync(path.join(tmp, 'content_scripts', '99.js'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'hot', '12.js'))).toBe(true)
  })
})
