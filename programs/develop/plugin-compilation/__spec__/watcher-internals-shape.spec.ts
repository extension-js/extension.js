import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'

// The two watcher plugins wrap and read rspack's watch file system, which is
// not a public API. This runs on every platform, so a bundler upgrade that
// reshapes it fails here and not only on a macOS session.
describe('the rspack watch file system the watcher plugins rely on', () => {
  let root: string

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  it('has a seven-argument watch and directory watchers with a scan flag', () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-')))
    fs.writeFileSync(path.join(root, 'a.js'), '')

    const compiler = rspack({
      context: root,
      entry: {},
      output: {path: path.join(root, 'dist')}
    })
    const watchFileSystem = compiler.watchFileSystem as unknown as {
      watch: (...args: unknown[]) => {close: () => void}
      watcher?: {
        watcherManager?: {directoryWatchers?: Map<string, object>}
      }
    }

    expect(typeof watchFileSystem.watch).toBe('function')
    expect(watchFileSystem.watch.length).toBe(7)

    const handle = watchFileSystem.watch(
      [path.join(root, 'a.js')],
      [root],
      [],
      Date.now(),
      {},
      () => {},
      () => {}
    )

    try {
      const directories =
        watchFileSystem.watcher?.watcherManager?.directoryWatchers

      expect(directories).toBeInstanceOf(Map)
      expect(directories?.size).toBeGreaterThan(0)

      for (const directory of directories?.values() || []) {
        expect(directory).toHaveProperty('initialScan')
        expect(directory).toHaveProperty('closed')
      }

      expect(typeof handle.close).toBe('function')
    } finally {
      handle.close()
    }
  })
})
