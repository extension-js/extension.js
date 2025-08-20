import {describe, it, beforeEach, afterEach, expect, vi} from 'vitest'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'

// Mock messages to avoid depending on exact string formatting
vi.mock('../../lib/messages', () => {
  return {
    serverRestartRequiredFromSpecialFolderError: vi.fn(
      (
        addingOrRemoving: string,
        folder: string,
        typeOfAsset: string,
        pathRelative: string
      ) => `[${addingOrRemoving}] ${folder} ${typeOfAsset} ${pathRelative}`
    )
  }
})

type Handler = (path: string) => void

class FakeWatcher {
  private readonly handlers: Record<string, Handler[]> = {}

  on(event: 'add' | 'unlink' | 'change', cb: Handler) {
    if (!this.handlers[event]) this.handlers[event] = []
    this.handlers[event].push(cb)
    return this
  }

  emit(event: 'add' | 'unlink' | 'change', filePath: string) {
    for (const cb of this.handlers[event] || []) cb(filePath)
  }

  async close() {
    return Promise.resolve()
  }
}

// Provide distinct watcher instances for each chokidar.watch call
const createdWatchers: FakeWatcher[] = []
vi.mock('chokidar', () => {
  return {
    watch: vi.fn((_p: string) => {
      const w = new FakeWatcher()
      createdWatchers.push(w)
      return w
    })
  }
})

// Minimal Compiler hook surface
const createFakeCompiler = () => {
  const hooks: any = {
    afterPlugins: {
      tap: (_name: string, fn: () => void) => fn()
    },
    watchClose: {
      tap: (_name: string, fn: () => void) => fn()
    }
  }

  const compiler: any = {
    options: {
      mode: 'development',
      watchOptions: {},
      resolve: {
        extensions: ['.js', '.ts']
      }
    },
    hooks
  }

  return compiler
}

describe('WarnUponFolderChanges', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createdWatchers.length = 0
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      // @ts-expect-error allow fake exit
      () => undefined
    )
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('warns when adding HTML under pages and errors/exits when removing it', async () => {
    const compiler = createFakeCompiler()
    const plugin = new WarnUponFolderChanges('/tmp/project/manifest.json')
    plugin.apply(compiler)

    // Expect two watchers: pages and scripts
    expect(createdWatchers.length).toBe(2)
    const pagesWatcher = createdWatchers[0]

    pagesWatcher.emit('add', '/tmp/project/pages/foo.html')
    expect(warnSpy).toHaveBeenCalledTimes(1)

    pagesWatcher.emit('unlink', '/tmp/project/pages/foo.html')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('warns when adding supported script under scripts and errors/exits when removing it', async () => {
    const compiler = createFakeCompiler()
    const plugin = new WarnUponFolderChanges('/tmp/project/manifest.json')
    plugin.apply(compiler)

    // scripts watcher is the second created watcher
    expect(createdWatchers.length).toBe(2)
    const scriptsWatcher = createdWatchers[1]

    scriptsWatcher.emit('add', '/tmp/project/scripts/content.js')
    expect(warnSpy).toHaveBeenCalled()

    scriptsWatcher.emit('unlink', '/tmp/project/scripts/content.js')
    expect(errorSpy).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
