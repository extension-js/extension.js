import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  classifyFromSession,
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from '../../__spec__/helpers/dev-watch-session'
import {skipWithoutDevelopDist} from './helpers/develop-dist'

interface EventSource {
  removeAllListeners?: (event: string) => void
}

interface WatchpackInternals {
  fileWatchers?: Map<
    string,
    {
      watcher?: {
        directoryWatcher?: {initialScan?: boolean; watcher?: EventSource}
      }
    }
  >
}

let root = ''
let session: DevWatchSession | undefined

beforeEach((context) => {
  skipWithoutDevelopDist(context)
})

afterEach(async () => {
  await session?.close()
  session = undefined
  if (root) fs.rmSync(root, {recursive: true, force: true})
})

// Written just before the session starts and never backdated: the case a
// tool that creates a project and edits it at once runs into.
function freshPopupProject() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-edit-after-ready-'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"edit-after-ready","version":"0.0.1","private":true}\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'edit-after-ready',
      version: '0.0.1',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(path.join(root, 'popup.js'), 'console.log("popup")\n')
  fs.writeFileSync(path.join(root, 'popup.html'), popupHtml('v0'))

  return path.join(root, 'popup.html')
}

function popupHtml(heading: string) {
  return `<!doctype html><html><body><h1>${heading}</h1><script src="./popup.js"></script></body></html>\n`
}

async function until(check: () => boolean, deadlineMs: number) {
  const giveUpAt = Date.now() + deadlineMs

  while (!check() && Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return check()
}

// A busy macOS can hold a folder event back for tens of seconds (measured up
// to 43 s). Dropping the folder's events stands in for that delay here.
function holdBackFolderEvents(session: DevWatchSession, file: string) {
  const watcher = (
    session.compiler.watchFileSystem as {watcher?: WatchpackInternals}
  ).watcher
  // The watcher is handed real paths, and the temp folder is a link on macOS.
  const folder = watcher?.fileWatchers?.get(fs.realpathSync(file))?.watcher
    ?.directoryWatcher

  if (!folder || folder.initialScan !== false) return false

  folder.watcher?.removeAllListeners?.('change')

  return true
}

describe.skipIf(process.platform !== 'darwin')(
  'an edit made right after the dev session is ready',
  () => {
    it('rebuilds and names a page reload while folder events are held back', async () => {
      const popup = freshPopupProject()
      const runs: Array<{at: number; files: string[]}> = []

      session = await openDevWatchSession(root, 'chrome', (compiler) => {
        compiler.hooks.watchRun.tap('spec-modified-files', () => {
          runs.push({
            at: Date.now(),
            files: [...(compiler.modifiedFiles ?? [])]
          })
        })
      })

      const first = await session.doneAfter(0)
      expect(errorsOf(first)).toEqual([])
      const active = session

      // The watch goes up right after ready, and a loaded machine can take
      // seconds to finish it. The edit lands the moment it is up, no settle.
      expect(
        await until(() => holdBackFolderEvents(active, popup), 10000)
      ).toBe(true)

      const watchedAt = Date.now()
      fs.writeFileSync(popup, popupHtml('v1'))
      const editedAt = Date.now()
      expect(editedAt - watchedAt).toBeLessThan(500)

      // Only a compile started after the write counts as the edit's rebuild.
      // The bundler names the file by its real path.
      const real = fs.realpathSync(popup)
      const editRun = () =>
        runs.findIndex((run) => run.at >= watchedAt && run.files.includes(real))
      expect(await until(() => editRun() >= 0, 10000)).toBe(true)

      const seen = editRun()
      const stats = await active.doneAfter(seen)
      expect(errorsOf(stats)).toEqual([])
      expect(classifyFromSession(active, stats)?.type).toBe('page')
    }, 30000)
  }
)
