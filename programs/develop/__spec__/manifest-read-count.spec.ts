import * as fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from './helpers/dev-watch-session'

const roots: string[] = []
const sessions: DevWatchSession[] = []
const realReadFileSync = fs.readFileSync

afterAll(async () => {
  for (const session of sessions) await session.close()
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-reads-'))
  )
  roots.push(root)

  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), text)
  }

  write(
    'package.json',
    JSON.stringify({name: 'manifest-reads', version: '0.0.1', private: true})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'manifest-reads',
      version: '0.0.1',
      description: 'first',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  write('background.js', 'console.log("background")\n')
  write('content.js', 'console.log("content")\n')
  write('popup.js', 'console.log("popup")\n')
  write(
    'popup.html',
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>\n'
  )

  return root
}

// Every direct read of the source manifest, by the file that made it.
function countManifestReads(manifestPath: string) {
  const nodeFs = process.getBuiltinModule('node:fs')
  let readers: string[] = []

  nodeFs.readFileSync = ((file: unknown, ...rest: unknown[]) => {
    if (typeof file === 'string' && path.resolve(file) === manifestPath) {
      const caller = (new Error().stack || '').split('\n')[2] || ''

      readers.push(
        caller
          .replace(/^.*[\\/](programs[\\/]develop|node_modules)[\\/]/, '')
          .replace(/:\d+:\d+\)?$/, '')
          .split(path.sep)
          .join('/')
      )
    }

    return (realReadFileSync as (...args: unknown[]) => unknown)(file, ...rest)
  }) as typeof fs.readFileSync

  syncBuiltinESMExports()

  return {
    take() {
      const taken = readers
      readers = []

      return taken
    },
    restore() {
      nodeFs.readFileSync = realReadFileSync
      syncBuiltinESMExports()
    }
  }
}

const SHARED_READER = 'lib/manifest/source-manifest.ts'
// The fields package reads the file itself, and the loader runs from dist
// with a copy of the reader that this spec cannot share.
const OTHER_READERS = [/^browser-extension-manifest-fields\//, /^dist\//]

const outside = (readers: string[]) =>
  readers.filter(
    (reader) =>
      reader !== SHARED_READER &&
      !OTHER_READERS.some((known) => known.test(reader))
  )

const shared = (readers: string[]) =>
  readers.filter((reader) => reader === SHARED_READER)

describe('reads of the source manifest in a dev session', () => {
  it('reads the file once per compilation and sees an edit in the next one', async () => {
    const root = project()
    const manifestPath = path.join(root, 'manifest.json')
    const reads = countManifestReads(manifestPath)

    try {
      const session = await openDevWatchSession(root, 'chrome')
      sessions.push(session)
      expect(errorsOf(await session.doneAfter(0))).toEqual([])
      let seen = await session.settle()
      const firstBuild = reads.take()

      // Once for the config, which is built before any compilation, and
      // once for the first compilation.
      expect(outside(firstBuild)).toEqual([])
      expect(shared(firstBuild)).toHaveLength(2)
      expect(firstBuild.length).toBeLessThanOrEqual(4)

      fs.writeFileSync(
        path.join(root, 'content.js'),
        'console.log("content two")\n'
      )

      expect(errorsOf(await session.doneAfter(seen))).toEqual([])
      seen = await session.settle()
      const rebuild = reads.take()

      expect(outside(rebuild)).toEqual([])
      expect(shared(rebuild)).toHaveLength(1)
      expect(rebuild.length).toBeLessThanOrEqual(1)

      const authored = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({...authored, description: 'second'})
      )

      expect(errorsOf(await session.doneAfter(seen))).toEqual([])
      await session.settle()
      reads.take()

      expect(
        JSON.parse(
          fs.readFileSync(path.join(session.distPath, 'manifest.json'), 'utf-8')
        ).description
      ).toBe('second')
    } finally {
      reads.restore()
    }
  }, 120000)
})
