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

function project(manifest: Record<string, unknown>, files: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-script-key-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'script-key', version: '0.0.1', private: true})
  )

  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))

  for (const file of files) {
    fs.writeFileSync(path.join(root, file), `console.log("${file}")\n`)
  }

  const past = new Date(Date.now() - 60000)

  for (const entry of fs.readdirSync(root)) {
    fs.utimesSync(path.join(root, entry), past, past)
  }

  return root
}

async function readySession(root: string, browser: string) {
  const session = await openDevWatchSession(root, browser)
  sessions.push(session)
  const first = await session.doneAfter(0)
  expect(errorsOf(first)).toEqual([])

  return {session, seen: await session.settle()}
}

function restartSpy() {
  const handler = vi.fn()
  const scheduler = new DevSessionRestartScheduler(0)
  scheduler.setHandler(handler)
  bindDevSessionRestart(scheduler)

  return handler
}

describe('a manifest edit that moves a script to another key under extension dev', () => {
  it('restarts when background.scripts becomes background.service_worker on the same file', async () => {
    const root = project(
      {
        manifest_version: 2,
        name: 'script-key',
        version: '0.0.1',
        background: {scripts: ['background.js']}
      },
      ['background.js']
    )
    const {session, seen} = await readySession(root, 'chrome')
    const handler = restartSpy()

    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'script-key',
        version: '0.0.1',
        background: {service_worker: 'background.js'}
      })
    )

    const stats = await session.doneAfter(seen)
    expect(errorsOf(stats)).toEqual([])
    await session.settle()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'scripts',
        pathChanged: path.join(root, 'background.js'),
        manifestFieldBefore: 'background.scripts',
        manifestField: 'background.service_worker'
      })
    )
  }, 90000)

  it('restarts when one content script entry is split in two with the same files', async () => {
    const root = project(
      {
        manifest_version: 3,
        name: 'script-key',
        version: '0.0.1',
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['a.js', 'b.js']}
        ]
      },
      ['a.js', 'b.js']
    )
    const {session, seen} = await readySession(root, 'firefox')
    const handler = restartSpy()

    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'script-key',
        version: '0.0.1',
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['a.js']},
          {matches: ['https://example.org/*'], js: ['b.js']}
        ]
      })
    )

    const stats = await session.doneAfter(seen)
    expect(errorsOf(stats)).toEqual([])
    await session.settle()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'scripts',
        pathChanged: path.join(root, 'b.js'),
        manifestFieldBefore: 'content_scripts[0].js',
        manifestField: 'content_scripts[1].js'
      })
    )
  }, 90000)
})
