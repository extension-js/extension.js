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
  errorsOf,
  openDevWatchSession
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

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-unrelated-write-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'options'), {recursive: true})
  fs.mkdirSync(path.join(root, 'content'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'unrelated-write', version: '0.0.1', private: true})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'unrelated-write',
      version: '0.0.1',
      background: {service_worker: 'background.js'},
      options_page: 'options/index.html',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'content', 'scripts.js'),
    'console.log("cs")\n'
  )

  fs.writeFileSync(
    path.join(root, 'options', 'index.html'),
    '<!doctype html><title>options</title><p>options</p>\n'
  )

  ageFiles(root)

  return root
}

function ageFiles(dir: string) {
  const past = new Date(Date.now() - 60000)

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) ageFiles(full)
    else fs.utimesSync(full, past, past)
  }
}

async function readySession(root: string) {
  const session = await openDevWatchSession(root)
  sessions.push(session)
  const first = await session.doneAfter(0)
  expect(errorsOf(first)).toEqual([])

  return {session, seen: await session.settle()}
}

describe('writes outside the build graph under extension dev', () => {
  it('a screenshot, a demo page and a note written in the project never rebuild', async () => {
    const root = project()
    const {session, seen} = await readySession(root)

    fs.mkdirSync(path.join(root, 'store', 'raw'), {recursive: true})
    fs.mkdirSync(path.join(root, 'store', 'demo'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'store', 'raw', 'shot.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    )

    fs.writeFileSync(
      path.join(root, 'store', 'demo', 'chart.html'),
      '<html>chart</html>'
    )

    fs.writeFileSync(path.join(root, 'NOTES.md'), 'notes\n')

    expect(await session.quietFor(2000)).toBe(seen)
    expect(fs.existsSync(path.join(session.distPath, 'store'))).toBe(false)
    expect(session.tracker.snapshot().changedSources).toEqual([])
  }, 60000)

  it('a public/ folder created mid-session restarts the session to ship it', async () => {
    const root = project()
    const {session, seen} = await readySession(root)
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    fs.mkdirSync(path.join(root, 'public'))
    fs.writeFileSync(path.join(root, 'public', 'data.json'), '{"value":"v1"}')
    const stats = await session.doneAfter(seen)
    expect(errorsOf(stats)).toEqual([])
    await session.settle()

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'public',
        pathAfter: path.join(root, 'public')
      })
    )
  }, 60000)

  it('a pages/ folder created mid-session still rebuilds', async () => {
    const root = project()
    const {session, seen} = await readySession(root)

    fs.mkdirSync(path.join(root, 'pages'))
    fs.writeFileSync(
      path.join(root, 'pages', 'extra.html'),
      '<!doctype html><title>extra</title>\n'
    )

    const stats = await session.doneAfter(seen)
    expect(errorsOf(stats)).toEqual([])
  }, 60000)
})
