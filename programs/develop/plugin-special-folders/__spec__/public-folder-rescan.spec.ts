import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {FileEventAssistPlugin} from '../../dev-server/file-event-assist'
import {SpecialFoldersPlugin} from '..'
import {
  fixtureCompiler,
  makeFixtureRoot,
  removeFixtureRoots,
  watchFixture
} from './helpers/compile-harness'

// Two folder polls in a row: the second lands while the first rescan runs.
// The folder must still rescan afterwards, or an added file never ships.

afterEach(() => {
  removeFixtureRoots()
})

const NEXT_BUILD_MS = 10_000

interface ScanState {
  scanning?: boolean
}

describe('a watch session over public/ with the folder poll', () => {
  it('rescans public/ again after a poll that landed mid-scan', async () => {
    const root = makeFixtureRoot({
      'index.js': 'self.out = 1\n',
      'manifest.json': '{"manifest_version": 3}',
      'public/rules.json': '{"v": 1}'
    })
    const publicDir = path.join(root, 'public')
    const polls = new Map<string, () => void>()
    const compiler = fixtureCompiler({
      root,
      mode: 'development',
      plugins: [
        new SpecialFoldersPlugin({
          manifestPath: path.join(root, 'manifest.json')
        }),
        new FileEventAssistPlugin({
          platform: 'darwin',
          pollFolder: (folder, onChange) => {
            polls.set(folder, onChange)

            return () => polls.delete(folder)
          }
        })
      ]
    })
    const watch = watchFixture(root, compiler)
    const folderWatcher = () =>
      (
        compiler.watchFileSystem as unknown as {
          watcher?: {
            watcherManager?: {directoryWatchers?: Map<string, ScanState>}
          }
        }
      ).watcher?.watcherManager?.directoryWatchers?.get(publicDir)

    const settled = async () => {
      for (let tries = 0; tries < 100; tries += 1) {
        if (folderWatcher()?.scanning === false) return true

        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      return false
    }

    try {
      expect(await watch.waitForBuild(1, NEXT_BUILD_MS)).toBeDefined()
      const poll = polls.get(publicDir)
      expect(poll).toBeTypeOf('function')
      expect(await settled()).toBe(true)

      poll?.()
      poll?.()

      expect(await settled()).toBe(true)
    } finally {
      await watch.close()
    }
  })
})
