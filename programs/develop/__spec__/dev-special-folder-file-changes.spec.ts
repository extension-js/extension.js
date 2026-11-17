import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../dev-server/session-restart'
import {
  type DevWatchSession,
  openDevWatchSession,
  waitUntil
} from './helpers/dev-watch-session'

const roots: string[] = []
const sessions: DevWatchSession[] = []

afterAll(async () => {
  for (const session of sessions) await session.close()
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  unbindDevSessionRestart()
})

const PAGE = '<!doctype html><html><body>page</body></html>\n'

function project() {
  // A real path, so the paths a restart names match the ones written here.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folder-files-'))
  )

  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), text)
  }

  roots.push(root)
  write(
    'package.json',
    JSON.stringify({name: 'folder-files', version: '0.0.1', private: true})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'folder-files',
      version: '0.0.1',
      background: {service_worker: 'background.js'}
    })
  )

  write('background.js', 'console.log("background")\n')
  write('pages/extra.html', PAGE)
  write('scripts/injected.js', 'console.log("injected")\n')

  const past = new Date(Date.now() - 60000)

  const age = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) age(full)
      else fs.utimesSync(full, past, past)
    }
  }

  age(root)

  return root
}

async function readySession(root: string) {
  const session = await openDevWatchSession(root, 'chrome')

  sessions.push(session)
  await session.doneAfter(0)
  await session.settle()

  const handler = vi.fn()
  const scheduler = new DevSessionRestartScheduler(0)

  scheduler.setHandler(handler)
  bindDevSessionRestart(scheduler)

  return handler
}

describe('a file added to or taken from pages/ and scripts/ under extension dev', () => {
  const cases = [
    {
      name: 'a deleted page',
      change: (root: string) => fs.rmSync(path.join(root, 'pages/extra.html')),
      request: (root: string) => ({
        reason: 'html',
        pathBefore: path.join(root, 'pages', 'extra.html')
      })
    },
    {
      name: 'a deleted script',
      change: (root: string) =>
        fs.rmSync(path.join(root, 'scripts/injected.js')),
      request: (root: string) => ({
        reason: 'scripts',
        pathBefore: path.join(root, 'scripts', 'injected.js')
      })
    },
    {
      name: 'an added page',
      change: (root: string) =>
        fs.writeFileSync(path.join(root, 'pages/added.html'), PAGE),
      request: (root: string) => ({
        reason: 'html',
        pathAfter: path.join(root, 'pages', 'added.html')
      })
    },
    {
      name: 'an added script',
      change: (root: string) =>
        fs.writeFileSync(path.join(root, 'scripts/fresh.js'), '// fresh\n'),
      request: (root: string) => ({
        reason: 'scripts',
        pathAfter: path.join(root, 'scripts', 'fresh.js')
      })
    },
    {
      name: 'a renamed page',
      change: (root: string) =>
        fs.renameSync(
          path.join(root, 'pages/extra.html'),
          path.join(root, 'pages/renamed.html')
        ),
      request: (root: string) => ({
        reason: 'html',
        pathBefore: path.join(root, 'pages', 'extra.html'),
        pathAfter: path.join(root, 'pages', 'renamed.html')
      })
    },
    {
      name: 'a renamed script',
      change: (root: string) =>
        fs.renameSync(
          path.join(root, 'scripts/injected.js'),
          path.join(root, 'scripts/moved.js')
        ),
      request: (root: string) => ({
        reason: 'scripts',
        pathBefore: path.join(root, 'scripts', 'injected.js'),
        pathAfter: path.join(root, 'scripts', 'moved.js')
      })
    }
  ]

  for (const {name, change, request} of cases) {
    it(`restarts the session for ${name}`, async () => {
      const root = project()
      const handler = await readySession(root)

      change(root)
      await waitUntil(() => handler.mock.calls.length > 0, 30000)

      expect(handler).toHaveBeenCalledWith(request(root))
    }, 90000)
  }

  it('does not restart for an edit to a page that was already there', async () => {
    const root = project()
    const handler = await readySession(root)
    const session = sessions[sessions.length - 1]
    const seen = await session.settle()

    fs.writeFileSync(
      path.join(root, 'pages/extra.html'),
      PAGE.replace('page', 'edited')
    )

    await session.doneAfter(seen)
    await session.settle()

    expect(handler).not.toHaveBeenCalled()
  }, 90000)
})
