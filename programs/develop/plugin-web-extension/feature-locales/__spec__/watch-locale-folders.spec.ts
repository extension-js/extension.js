import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession,
  waitUntil
} from '../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

// A real rspack watch over a project with locales. Each test adds a file the
// session has never seen and waits for the rebuild that addition owes.
const tempFolder = trackTempFolders()
const sessions: DevWatchSession[] = []

afterAll(async () => {
  for (const session of sessions) await session.close()
})

function writeProject(files: Record<string, string>) {
  const root = fs.realpathSync(tempFolder('extjs-locale-watch-'))
  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'locale-watch',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'locale-watch',
      version: '1.0.0',
      default_locale: 'en'
    }),
    ...files
  }

  for (const [name, contents] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), contents)
  }

  return root
}

async function open(root: string) {
  const session = await openDevWatchSession(root)
  sessions.push(session)

  return session
}

// Saves one file and returns the rebuild that follows, or fails after ten
// seconds when the watcher never heard about the file.
async function saveAndRebuild(
  session: DevWatchSession,
  root: string,
  name: string,
  contents: string
) {
  const seen = await session.settle()
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
  fs.writeFileSync(path.join(root, name), contents)

  return session.doneAfter(seen, 10000)
}

const shipped = (session: DevWatchSession, name: string) =>
  fs.existsSync(path.join(session.distPath, name))

const MESSAGES = '{"hello":{"message":"hi"}}\n'

describe('watching the _locales folder', () => {
  it('ships a locale folder created while the session runs', async () => {
    const root = writeProject({'_locales/en/messages.json': MESSAGES})
    const session = await open(root)

    await waitUntil(() => shipped(session, '_locales/en/messages.json'))
    expect(shipped(session, '_locales/en/messages.json')).toBe(true)

    const stats = await saveAndRebuild(
      session,
      root,
      '_locales/pt_BR/messages.json',
      '{"hello":{"message":"oi"}}\n'
    )

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(
      () => shipped(session, '_locales/pt_BR/messages.json'),
      10000
    )

    expect(shipped(session, '_locales/pt_BR/messages.json')).toBe(true)
  }, 120000)

  it('ships a file added beside messages.json', async () => {
    const root = writeProject({'_locales/en/messages.json': MESSAGES})
    const session = await open(root)

    await waitUntil(() => shipped(session, '_locales/en/messages.json'))

    const stats = await saveAndRebuild(
      session,
      root,
      '_locales/en/notes.md',
      'notes\n'
    )

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => shipped(session, '_locales/en/notes.md'), 10000)
    expect(shipped(session, '_locales/en/notes.md')).toBe(true)
  }, 120000)

  it('rebuilds when the folder the manifest asks for is created', async () => {
    const root = writeProject({})
    const session = await open(root)
    const seen = await session.settle()
    const first = await session.doneAfter(seen - 1)

    // default_locale with no _locales folder is refused, and the fix for
    // that error is the very folder the session has to notice.
    expect(errorsOf(first).length).toBeGreaterThan(0)

    const stats = await saveAndRebuild(
      session,
      root,
      '_locales/en/messages.json',
      MESSAGES
    )

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => shipped(session, '_locales/en/messages.json'), 10000)

    expect(shipped(session, '_locales/en/messages.json')).toBe(true)
  }, 120000)
})
