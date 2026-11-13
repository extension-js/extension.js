import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../dev-server/session-restart'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession,
  waitUntil
} from './helpers/dev-watch-session'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()
const sessions: DevWatchSession[] = []

afterAll(async () => {
  for (const session of sessions.splice(0)) await session.close()
})

afterEach(() => {
  unbindDevSessionRestart()
})

interface WatchCall {
  files: string[]
  directories: string[]
  missing: string[]
}

function canLink(): boolean {
  const probe = makeTempFolder('extjs-link-probe-')

  try {
    fs.mkdirSync(path.join(probe, 'target'))
    fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'dir')

    return true
  } catch {
    return false
  }
}

function linkedProject() {
  const base = fs.realpathSync(makeTempFolder('extjs-linked-root-'))
  const real = path.join(base, 'real-project')
  const linked = path.join(base, 'linked-project')

  fs.mkdirSync(path.join(real, 'content'), {recursive: true})
  fs.mkdirSync(path.join(real, 'options'), {recursive: true})
  fs.writeFileSync(
    path.join(real, 'package.json'),
    JSON.stringify({name: 'linked-root', version: '0.0.1', private: true})
  )

  fs.writeFileSync(
    path.join(real, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'linked-root',
      version: '0.0.1',
      background: {service_worker: 'background.js'},
      options_page: 'options/index.html',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  fs.writeFileSync(path.join(real, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(real, 'content', 'scripts.js'),
    'console.log("cs")\n'
  )

  fs.writeFileSync(
    path.join(real, 'options', 'index.html'),
    '<!doctype html><title>options</title><script src="./options.js"></script>\n'
  )

  fs.writeFileSync(
    path.join(real, 'options', 'options.js'),
    'console.log("options")\n'
  )

  fs.symlinkSync(real, linked, 'dir')

  return {base, real, linked}
}

// Records what each watch call is handed, from the first one on.
function recordWatchCalls(calls: WatchCall[]) {
  return (compiler: Compiler) => {
    const watchFileSystem = compiler.watchFileSystem as unknown as {
      watch: (
        files: Iterable<string>,
        directories: Iterable<string>,
        missing: Iterable<string>,
        ...rest: unknown[]
      ) => unknown
    }
    const watch = watchFileSystem.watch.bind(watchFileSystem)

    watchFileSystem.watch = (files, directories, missing, ...rest) => {
      const call = {
        files: [...files],
        directories: [...directories],
        missing: [...missing]
      }

      calls.push(call)

      return watch(call.files, call.directories, call.missing, ...rest)
    }
  }
}

function isAtOrBelow(folder: string, target: string): boolean {
  return target === folder || target.startsWith(folder + path.sep)
}

describe.skipIf(!canLink())('dev: a project behind a linked path', () => {
  it('hands the watcher one path per file and no path joined under the project', async () => {
    const {base, real, linked} = linkedProject()
    const calls: WatchCall[] = []
    const session = await openDevWatchSession(
      linked,
      'chrome',
      recordWatchCalls(calls)
    )

    sessions.push(session)

    const first = await session.doneAfter(0)

    expect(errorsOf(first)).toEqual([])
    await session.settle()

    const watched = calls.flatMap((call) => [
      ...call.files,
      ...call.directories,
      ...call.missing
    ])
    const files = calls.flatMap((call) => call.files)

    // The build did reach the project, and by its real path.
    expect(files).toEqual(
      expect.arrayContaining([
        path.join(real, 'manifest.json'),
        path.join(real, 'background.js'),
        path.join(real, 'content', 'scripts.js'),
        path.join(real, 'options', 'index.html'),
        path.join(real, 'options', 'options.js')
      ])
    )

    expect(watched.filter((target) => isAtOrBelow(linked, target))).toEqual([])

    // A whole path joined again under a folder repeats the temp base in it.
    expect(watched.filter((target) => target.indexOf(base, 1) !== -1)).toEqual(
      []
    )

    // The develop package's own files are whole paths too.
    const developRoot = path.resolve(__dirname, '..')

    expect(
      watched.filter(
        (target) =>
          isAtOrBelow(real, target) && target.indexOf(developRoot, 1) !== -1
      )
    ).toEqual([])
  }, 120000)

  it('still rebuilds for an edit, and reports it under the path that was asked for', async () => {
    const {real, linked} = linkedProject()
    const modified: string[][] = []
    const session = await openDevWatchSession(linked, 'chrome', (compiler) => {
      compiler.hooks.watchRun.tap('spec-read-modified', () => {
        modified.push([...(compiler.modifiedFiles ?? [])])
      })
    })

    sessions.push(session)
    await session.doneAfter(0)

    const settled = await session.settle()

    // A module is named by its real path, in the build and in the watcher.
    fs.writeFileSync(
      path.join(linked, 'background.js'),
      'console.log("bg edited")\n'
    )

    expect(errorsOf(await session.doneAfter(settled))).toEqual([])
    await waitUntil(() =>
      modified.some((files) => files.includes(path.join(real, 'background.js')))
    )

    expect(modified.flat()).toContain(path.join(real, 'background.js'))

    // The manifest was asked for under the linked path and answers under it.
    const beforeManifest = await session.settle()
    const manifestPath = path.join(linked, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({...manifest, description: 'edited'})
    )

    await session.doneAfter(beforeManifest)
    await waitUntil(() =>
      modified.some((files) => files.includes(manifestPath))
    )

    expect(modified.flat()).toContain(manifestPath)
    expect(modified.flat()).not.toContain(path.join(real, 'manifest.json'))
  }, 120000)

  it('restarts the session for a public folder made through either spelling', async () => {
    for (const makeThroughLink of [true, false]) {
      const {real, linked} = linkedProject()
      const session = await openDevWatchSession(linked)

      sessions.push(session)
      await session.doneAfter(0)

      const seen = await session.settle()
      const handler = vi.fn()
      const scheduler = new DevSessionRestartScheduler(0)

      scheduler.setHandler(handler)
      bindDevSessionRestart(scheduler)

      const made = path.join(makeThroughLink ? linked : real, 'public')

      fs.mkdirSync(made)
      fs.writeFileSync(path.join(made, 'data.json'), '{"value":"v1"}')

      expect(errorsOf(await session.doneAfter(seen))).toEqual([])
      await waitUntil(() => handler.mock.calls.length > 0)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'public',
          pathAfter: path.join(linked, 'public')
        })
      )

      unbindDevSessionRestart()
    }
  }, 180000)
})
