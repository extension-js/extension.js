import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Stats} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  openDevWatchSession
} from '../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()
const sessions: DevWatchSession[] = []

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close()
})

function project() {
  const root = fs.realpathSync(tempFolder('extjs-war-deleted-'))
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'w',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'w',
      version: '1.0.0',
      background: {service_worker: 'bg.js'},
      web_accessible_resources: [
        {
          resources: ['war/file.txt', 'war/kept.txt'],
          matches: ['https://a.example/*']
        }
      ]
    }),
    'bg.js': 'console.log("bg")\n',
    'war/file.txt': 'listed',
    'war/kept.txt': 'kept'
  }

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

const missingOf = (stats: Stats) =>
  Array.from(stats.compilation.warnings as Iterable<Error>)
    .filter(({name}) => name === 'WARRelativeAssetMissing')
    .map(({message}) => plain(String(message)))

const listed = (session: DevWatchSession) =>
  JSON.parse(
    fs.readFileSync(path.join(session.distPath, 'manifest.json'), 'utf8')
  ).web_accessible_resources.flatMap(
    (group: {resources: string[]}) => group.resources
  ) as string[]

// A copy an earlier build left in the output folder is not the file: only
// the source, or a file this build emits, makes a listed entry present.
describe('a web_accessible_resources file deleted in a dev session', () => {
  it('warns as a fresh build would, and the old copy stops shipping', async () => {
    const root = project()
    const session = await openDevWatchSession(root)
    sessions.push(session)

    const seen = await session.settle()
    const shipped = path.join(session.distPath, 'war', 'file.txt')

    expect(missingOf(await session.doneAfter(seen - 1))).toEqual([])
    expect(fs.readFileSync(shipped, 'utf8')).toBe('listed')
    expect(listed(session)).toEqual(
      expect.arrayContaining(['war/file.txt', 'war/kept.txt'])
    )

    fs.rmSync(path.join(root, 'war', 'file.txt'))
    session.compiler.watching?.invalidate()

    const rebuilt = await session.doneAfter(seen, 30000)
    const warnings = missingOf(rebuilt)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      "Can't find the file war/file.txt listed in web_accessible_resources"
    )

    expect(Array.from(rebuilt.compilation.errors)).toEqual([])
    expect(listed(session)).toContain('war/kept.txt')
    expect(listed(session)).not.toContain('war/file.txt')
    expect(fs.existsSync(shipped)).toBe(false)
    expect(
      fs.readFileSync(path.join(session.distPath, 'war', 'kept.txt'), 'utf8')
    ).toBe('kept')
  }, 120000)
})
