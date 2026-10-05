import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {suppressManifestOutputWrites} from '../index'

function makeSharedOutputFs() {
  const written: string[] = []

  return {
    fs: {
      writeFileSync(filePath: string, _data: unknown) {
        written.push(filePath)
      }
    } as {
      writeFileSync: (filePath: string, data: unknown) => void
      __extensionjsGuardedManifestPaths?: Map<string, number>
    },
    written
  }
}

describe('suppressManifestOutputWrites with two servers on one dist', () => {
  it('keeps the manifest guarded until the last owner releases', () => {
    const shared = makeSharedOutputFs()
    const manifest = path.resolve('dist', 'chrome', 'manifest.json')
    const count = () =>
      shared.fs.__extensionjsGuardedManifestPaths?.get(manifest)

    const releaseA = suppressManifestOutputWrites(
      {outputFileSystem: shared.fs},
      manifest
    )
    expect(count()).toBe(1)

    const releaseB = suppressManifestOutputWrites(
      {outputFileSystem: shared.fs},
      manifest
    )
    expect(count()).toBe(2)

    shared.fs.writeFileSync(manifest, '{}')
    expect(shared.written).toEqual([])

    releaseA()
    expect(count()).toBe(1)

    shared.fs.writeFileSync(manifest, '{}')
    expect(shared.written).toEqual([])

    releaseA()
    expect(count()).toBe(1)

    releaseB()
    expect(count()).toBeUndefined()

    shared.fs.writeFileSync(manifest, '{}')
    expect(shared.written).toEqual([manifest])
  })
})
