import {EventEmitter} from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {FileEventAssistPlugin} from '../file-event-assist'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

function project(files: string[]) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-file-event-assist-'))
  )
  roots.push(root)

  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), 'x\n')
  }

  return root
}

class FakeHandle extends EventEmitter {
  closed = false
  close() {
    this.closed = true
  }
}

function harness(
  root: string,
  options: {poll?: number; max?: number; folders?: string[]} = {}
) {
  const onWatchEvent = vi.fn()
  const doScan = vi.fn()
  const emit = vi.fn()
  const polled = new Map<string, () => void>()
  const stopped: string[] = []
  const handles = new Map<string, FakeHandle>()
  const listeners = new Map<string, (type: string) => void>()
  const opened: string[] = []
  const taps: Record<string, Array<() => void>> = {watchRun: [], watchClose: []}
  const watchFileSystem: {
    watcher?: unknown
    watch: (files: string[]) => unknown
  } = {
    watch(files: string[]) {
      watchFileSystem.watcher = {
        watcherManager: {
          directoryWatchers: new Map(
            (options.folders ?? []).map((folder) => [folder, {doScan}])
          )
        },
        fileWatchers: new Map(
          files.map((file) => [
            file,
            {
              watcher: {
                directoryWatcher: {onWatchEvent, files: new Map()},
                emit
              }
            }
          ])
        )
      }

      return {}
    }
  }
  const compiler = {
    context: root,
    options: {context: root, experiments: {}},
    watching: {watchOptions: options.poll ? {poll: options.poll} : {}},
    watchFileSystem,
    hooks: {
      watchRun: {
        tap: (_name: string, fn: () => void) => taps.watchRun.push(fn)
      },
      watchClose: {
        tap: (_name: string, fn: () => void) => taps.watchClose.push(fn)
      }
    }
  }
  const plugin = new FileEventAssistPlugin({
    platform: 'darwin',
    maxWatches: options.max,
    pollFolder: (folder, onChange) => {
      polled.set(folder, onChange)

      return () => stopped.push(folder)
    },
    watchFile: (file, listener) => {
      const handle = new FakeHandle()
      handles.set(file, handle)
      listeners.set(file, listener)
      opened.push(file)

      return handle as unknown as fs.FSWatcher
    }
  })

  plugin.apply(compiler as never)
  for (const fn of taps.watchRun) fn()

  return {
    compiler,
    onWatchEvent,
    doScan,
    emit,
    polled,
    stopped,
    handles,
    opened,
    fire: (file: string, type: string) => listeners.get(file)?.(type),
    close: () => {
      for (const fn of taps.watchClose) fn()
    }
  }
}

describe('FileEventAssistPlugin', () => {
  it('hands a file event to the folder watcher that owns the file', () => {
    const root = project(['popup.html', 'popup.js'])
    const popup = path.join(root, 'popup.html')
    const run = harness(root)

    run.compiler.watchFileSystem.watch([popup, path.join(root, 'popup.js')])
    run.fire(popup, 'change')

    expect(run.onWatchEvent).toHaveBeenCalledWith('change', 'popup.html')
  })

  it('watches only existing project files outside node_modules', () => {
    const root = project(['src/a.js', 'node_modules/pkg/index.js'])
    const outside = project(['b.js'])
    const run = harness(root)

    run.compiler.watchFileSystem.watch([
      path.join(root, 'src/a.js'),
      path.join(root, 'src/gone.js'),
      path.join(root, 'node_modules/pkg/index.js'),
      path.join(root, 'src'),
      path.join(outside, 'b.js')
    ])

    expect(run.opened).toEqual([path.join(root, 'src/a.js')])
  })

  it('reopens a file a save replaced and closes files the next watch drops', async () => {
    const root = project(['a.js', 'b.js'])
    const a = path.join(root, 'a.js')
    const b = path.join(root, 'b.js')
    const run = harness(root)

    run.compiler.watchFileSystem.watch([a, b])
    const firstA = run.handles.get(a)
    run.fire(a, 'rename')
    await new Promise((resolve) => setImmediate(resolve))

    expect(firstA?.closed).toBe(true)
    expect(run.opened.filter((file) => file === a)).toHaveLength(2)

    run.compiler.watchFileSystem.watch([a])
    expect(run.handles.get(b)?.closed).toBe(true)

    run.close()
    expect(run.handles.get(a)?.closed).toBe(true)
  })

  it('stops at the cap and stays out of a polling session', () => {
    const root = project(['a.js', 'b.js', 'c.js'])
    const files = ['a.js', 'b.js', 'c.js'].map((file) => path.join(root, file))
    const capped = harness(root, {max: 2})

    capped.compiler.watchFileSystem.watch(files)
    expect(capped.opened).toHaveLength(2)

    const polled = harness(root, {poll: 1000})
    polled.compiler.watchFileSystem.watch(files)
    expect(polled.opened).toEqual([])
  })

  it('scans a project folder again when its mtime moves, never one above it', () => {
    const root = project(['pages/a.html'])
    const pages = path.join(root, 'pages')
    const run = harness(root, {
      folders: [
        path.dirname(root),
        root,
        pages,
        path.join(root, 'node_modules')
      ]
    })

    run.compiler.watchFileSystem.watch([path.join(pages, 'a.html')])
    expect([...run.polled.keys()]).toEqual([root, pages])

    run.polled.get(pages)?.()
    expect(run.doScan).toHaveBeenCalledWith(false)

    run.close()
    expect(run.stopped).toEqual([root, pages])
  })

  it('reports a deletion the folder watcher never recorded, not a replaced file', () => {
    const root = project(['kept.js', 'gone.js'])
    const kept = path.join(root, 'kept.js')
    const gone = path.join(root, 'gone.js')
    const run = harness(root)

    run.compiler.watchFileSystem.watch([kept, gone])
    run.fire(kept, 'rename')
    expect(run.emit).not.toHaveBeenCalled()

    fs.rmSync(gone)
    run.fire(gone, 'rename')
    expect(run.emit).toHaveBeenCalledWith('remove', 'rename')
  })

  it('finds a write or a deletion made before the file watch was armed', async () => {
    const root = project(['edited.js', 'deleted.js'])
    const edited = path.join(root, 'edited.js')
    const deleted = path.join(root, 'deleted.js')
    const run = harness(root)

    run.compiler.watchFileSystem.watch([edited, deleted])
    fs.utimesSync(edited, new Date(), new Date(Date.now() + 5000))
    fs.rmSync(deleted)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(run.onWatchEvent).toHaveBeenCalledWith('change', 'edited.js')
    expect(run.onWatchEvent).toHaveBeenCalledWith('rename', 'deleted.js')
    expect(run.emit).toHaveBeenCalledWith('remove', 'rename')
  })
})
