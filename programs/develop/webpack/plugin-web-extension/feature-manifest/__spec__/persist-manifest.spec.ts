import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it} from 'vitest'

import {PersistManifestToDisk} from '../steps/persist-manifest'

describe('PersistManifestToDisk', () => {
  it('writes the final manifest asset to disk atomically', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'persist-manifest-')
    )
    let tapRan = false

    const compilation: any = {
      errors: [],
      outputOptions: {path: outputDir},
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => {
            tapRan = true
            fn()
          }
        }
      },
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {
              source: {
                source: () => '{\n  "name": "x"\n}'
              }
            }
          : undefined
    }

    const compiler: any = {
      options: {output: {path: outputDir}},
      hooks: {
        thisCompilation: {tap: (_name: string, fn: any) => fn(compilation)}
      }
    }

    new PersistManifestToDisk().apply(compiler)

    expect(tapRan).toBe(true)
    expect(
      fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8')
    ).toBe('{\n  "name": "x"\n}')
    expect(
      fs
        .readdirSync(outputDir)
        .filter(
          (entry) => entry.includes('.manifest.') && entry.endsWith('.tmp')
        )
    ).toEqual([])
  })
})
