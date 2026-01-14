import {describe, it, beforeEach, expect, vi} from 'vitest'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'
import * as messages from '../messages'

// Mock messages to avoid relying on terminal color formatting
vi.mock('../messages', () => ({
  serverRestartRequiredFromSpecialFolderMessageOnly: vi.fn(
    (addingOrRemoving: string, folder: string, typeOfAsset: string) =>
      `[${addingOrRemoving}] ${folder} ${typeOfAsset}`
  )
}))

type WatchEvent = 'add' | 'unlink' | 'change'
type WatchHandler = (filePath: string) => void

class FakeWatcher {
  private readonly handlers: Record<WatchEvent, WatchHandler[]> = {
    add: [],
    unlink: [],
    change: []
  }
  public readonly close = vi.fn(async () => Promise.resolve())

  on(event: WatchEvent, callback: WatchHandler) {
    this.handlers[event]?.push(callback)
    return this
  }

  emit(event: WatchEvent, filePath: string) {
    for (const callback of this.handlers[event] || []) callback(filePath)
  }
}

// Provide distinct watcher instances for each chokidar.watch call
const createdWatchers: FakeWatcher[] = []
vi.mock('chokidar', () => {
  return {
    watch: vi.fn((_absPath: string) => {
      const watcherInstance = new FakeWatcher()
      createdWatchers.push(watcherInstance)
      return watcherInstance
    })
  }
})

// Minimal Compiler hook surface
const createFakeCompiler = () => {
  const watchCloseCallbacks: Array<() => void> = []
  const hooks: any = {
    thisCompilation: {
      tap: (_name: string, callback: (c: any) => void) => callback(compilation)
    },
    watchClose: {
      tap: (_name: string, callback: () => void) => {
        watchCloseCallbacks.push(callback)
      },
      __invokeAll: () => watchCloseCallbacks.forEach((cb) => cb())
    }
  }

  const compiler: any = {
    options: {
      mode: 'development',
      watchOptions: {},
      resolve: {extensions: ['.js', '.ts']}
    },
    hooks
  }
  return compiler
}

// Provide a shared compilation-like sink to capture warnings/errors
let compilation: {warnings: any[]; errors: any[]}

beforeEach(() => {
  createdWatchers.length = 0
  compilation = {warnings: [], errors: []}
  vi.clearAllMocks()
})

describe('WarnUponFolderChanges', () => {
  it('warns on adding pages/*.html and errors on removing', () => {
    const compiler = createFakeCompiler()
    new WarnUponFolderChanges().apply(compiler as any)

    // Expect two watchers: pages and scripts
    expect(createdWatchers.length).toBe(2)
    const pagesWatcher = createdWatchers[0]

    pagesWatcher.emit('add', '/project/pages/foo.html')
    expect(compilation.warnings.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Adding', 'pages', 'HTML pages')

    pagesWatcher.emit('unlink', '/project/pages/foo.html')
    expect(compilation.errors.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Removing', 'pages', 'HTML pages')
  })

  it('warns on adding supported scripts and errors on removing; ignores unsupported extensions', () => {
    const compiler = createFakeCompiler()
    new WarnUponFolderChanges().apply(compiler as any)

    const scriptsWatcher = createdWatchers[1]

    scriptsWatcher.emit('add', '/project/scripts/content.ts')
    expect(compilation.warnings.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Adding', 'scripts', 'script files')

    // Unsupported extension should not trigger any new warning
    scriptsWatcher.emit('add', '/project/scripts/note.md')
    expect(compilation.warnings.length).toBe(1)

    scriptsWatcher.emit('unlink', '/project/scripts/content.ts')
    expect(compilation.errors.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Removing', 'scripts', 'script files')
  })

  it('ignores non-HTML additions/removals in pages/', () => {
    const compiler = createFakeCompiler()
    new WarnUponFolderChanges().apply(compiler as any)

    const pagesWatcher = createdWatchers[0]
    pagesWatcher.emit('add', '/project/pages/readme.txt')
    pagesWatcher.emit('unlink', '/project/pages/readme.txt')

    expect(compilation.warnings.length).toBe(0)
    expect(compilation.errors.length).toBe(0)
  })

  it('closes watchers on watchClose', () => {
    const compiler = createFakeCompiler()
    new WarnUponFolderChanges().apply(compiler as any)

    expect(createdWatchers.length).toBe(2)
    ;(compiler.hooks.watchClose as any).__invokeAll()
    expect(createdWatchers[0].close).toHaveBeenCalled()
    expect(createdWatchers[1].close).toHaveBeenCalled()
  })
})
