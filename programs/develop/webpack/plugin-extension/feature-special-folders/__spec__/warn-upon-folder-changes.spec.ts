import {describe, it, beforeEach, afterEach, expect, vi} from 'vitest'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'

// Mock messages to avoid depending on exact string formatting
vi.mock('../../webpack-lib/messages', () => {
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
    thisCompilation: {
      tap: (_name: string, fn: (c: any) => void) => fn(compilation)
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

// Provide a shared compilation-like sink to capture warnings/errors
let compilation: any

describe('WarnUponFolderChanges', () => {
  let warningsPush: ReturnType<typeof vi.fn>
  let errorsPush: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createdWatchers.length = 0
    warningsPush = vi.fn()
    errorsPush = vi.fn()
    compilation = {warnings: {push: warningsPush}, errors: {push: errorsPush}}
  })

  afterEach(() => {
    // no-op
  })

  it('warns when adding HTML under pages and errors/exits when removing it', async () => {
    const compiler = createFakeCompiler()
    const plugin = new WarnUponFolderChanges('/tmp/project/manifest.json')
    plugin.apply(compiler)

    // Expect two watchers: pages and scripts
    expect(createdWatchers.length).toBe(2)
    const pagesWatcher = createdWatchers[0]

    pagesWatcher.emit('add', '/tmp/project/pages/foo.html')
    expect(warningsPush).toHaveBeenCalledTimes(1)

    pagesWatcher.emit('unlink', '/tmp/project/pages/foo.html')
    expect(errorsPush).toHaveBeenCalledTimes(1)
  })

  it('warns when adding supported script under scripts and errors/exits when removing it', async () => {
    const compiler = createFakeCompiler()
    const plugin = new WarnUponFolderChanges('/tmp/project/manifest.json')
    plugin.apply(compiler)

    // scripts watcher is the second created watcher
    expect(createdWatchers.length).toBe(2)
    const scriptsWatcher = createdWatchers[1]

    scriptsWatcher.emit('add', '/tmp/project/scripts/content.js')
    expect(warningsPush).toHaveBeenCalled()

    scriptsWatcher.emit('unlink', '/tmp/project/scripts/content.js')
    expect(errorsPush).toHaveBeenCalled()
  })
})
