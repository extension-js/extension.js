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

// A scan asked for while one runs: by a second folder poll, or by the
// watcher itself. The folder must still rescan afterwards, or an added file
// never ships.

afterEach(() => {
  removeFixtureRoots()
})

const NEXT_BUILD_MS = 10_000
// A stuck watcher never goes idle, so a slow scan on a busy machine gets
// a long window without letting a stuck one pass.
const SETTLE_MS = 10_000
const ROW_MS = NEXT_BUILD_MS + SETTLE_MS * 3 + 5_000

interface ScanState {
  scanning?: boolean
  // The event source of the folder.
  watcher?: {emit: (event: string) => void}
}

describe('a watch session over public/ with the folder poll', () => {
  it(
    'rescans public/ again after a scan that was asked for mid-scan',
    async () => {
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
      // Only the assist above, so the injected poll is the only one running.
      const watch = watchFixture(root, compiler, {assist: false})
      const folderWatcher = () =>
        (
          compiler.watchFileSystem as unknown as {
            watcher?: {
              watcherManager?: {directoryWatchers?: Map<string, ScanState>}
            }
          }
        ).watcher?.watcherManager?.directoryWatchers?.get(publicDir)

      const settled = async () => {
        for (let tries = 0; tries < SETTLE_MS / 20; tries += 1) {
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

        // The watcher asks for a scan of its own after its event stream
        // restarts, which a rebuild causes. Here it lands mid-scan.
        poll?.()
        expect(folderWatcher()?.scanning).toBe(true)
        folderWatcher()?.watcher?.emit('rescan')

        expect(await settled()).toBe(true)
      } finally {
        await watch.close()
      }
    },
    ROW_MS
  )
})
