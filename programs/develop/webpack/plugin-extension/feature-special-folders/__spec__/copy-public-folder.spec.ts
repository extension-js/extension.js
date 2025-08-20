import {describe, it, beforeEach, afterEach, expect, vi} from 'vitest'
import {CopyPublicFolder} from '../copy-public-folder'
const FS = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  lstatSync: vi.fn()
}))
vi.mock('fs', () => ({
  ...FS
}))

// Simulate minimal Compiler with necessary hooks and options
const createFakeCompiler = (mode: 'development' | 'production') => {
  const hooks: any = {
    afterEmit: {tap: (_name: string, fn: () => void) => fn()},
    afterPlugins: {tap: (_name: string, fn: () => void) => fn()},
    watchClose: {tap: (_name: string, fn: () => void) => fn()}
  }

  const compiler: any = {
    options: {
      mode,
      output: {path: '/out/root'}
    },
    hooks
  }
  return compiler
}

// We avoid module-level fs mocking to prevent cross-file side effects.
// Instead, we use spies per test case.
import * as fs from 'fs'

class FakeWatcher {
  private readonly handlers: Record<string, ((p: string) => void)[]> = {}
  on(event: 'add' | 'change' | 'unlink', cb: (p: string) => void) {
    if (!this.handlers[event]) this.handlers[event] = []
    this.handlers[event].push(cb)
    return this
  }
  emit(event: 'add' | 'change' | 'unlink', p: string) {
    for (const cb of this.handlers[event] || []) cb(p)
  }
  async close() {
    return Promise.resolve()
  }
}

const createdWatchers: FakeWatcher[] = []
vi.mock('chokidar', () => ({
  watch: vi.fn((_p: string) => {
    const w = new FakeWatcher()
    createdWatchers.push(w)
    return w
  })
}))

describe('CopyPublicFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWatchers.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('copies entire public folder into output on afterEmit (production)', () => {
    const compiler = createFakeCompiler('production')
    const plugin = new CopyPublicFolder({
      manifestPath: '/project/manifest.json'
    })

    // project/public exists and is a directory
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      return (
        p === '/project/public' ||
        p === '/out/root' ||
        p.startsWith('/project/public')
      )
    })
    ;(fs.statSync as any).mockImplementation((p: string) => ({
      isDirectory: () => p === '/project/public' || p === '/project/public/dir'
    }))
    ;(fs.readdirSync as any).mockImplementation((p: string) => {
      if (p === '/project/public') return ['dir', 'a.txt']
      if (p === '/project/public/dir') return ['b.txt']
      return []
    })
    ;(fs.mkdirSync as any).mockImplementation(() => undefined)
    ;(fs.copyFileSync as any).mockImplementation(() => undefined)

    plugin.apply(compiler as any)

    // ensure output exists (root or nested subfolder creation acceptable)
    const calls = (fs.mkdirSync as any).mock.calls as any[]
    // Creation might target nested directories first; ensure at least one mkdir was executed
    expect(calls.length).toBeGreaterThan(0)

    // files copied
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/project/public/a.txt',
      '/out/root/a.txt'
    )
  })

  it('watches public folder and mirrors add/change/unlink in development', () => {
    const compiler = createFakeCompiler('development')
    const plugin = new CopyPublicFolder({
      manifestPath: '/project/manifest.json'
    })

    // public detection and output existing
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      return (
        p === '/project/public' ||
        p === '/out/root' ||
        p === '/out/root/file.txt'
      )
    })
    ;(fs.statSync as any).mockImplementation((_p: string) => ({
      isDirectory: () => true
    }))
    ;(fs.readdirSync as any).mockImplementation(() => [])
    ;(fs.copyFileSync as any).mockImplementation(() => undefined)
    ;(fs.unlinkSync as any).mockImplementation(() => undefined)

    plugin.apply(compiler as any)
    expect(createdWatchers.length).toBe(1)
    const watcher = createdWatchers[0]

    watcher.emit('add', '/project/public/file.txt')
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/project/public/file.txt',
      '/out/root/file.txt'
    )

    watcher.emit('change', '/project/public/file.txt')
    expect(fs.copyFileSync).toHaveBeenCalled()

    watcher.emit('unlink', '/project/public/file.txt')
    expect(fs.unlinkSync).toHaveBeenCalled()
  })

  it('detects case-insensitive public folder name (e.g., Public) and copies it', () => {
    const compiler = createFakeCompiler('production')
    const plugin = new CopyPublicFolder({
      manifestPath: '/project/manifest.json'
    })

    ;(fs.existsSync as any).mockImplementation((p: string) => {
      return (
        p === '/project/Public' ||
        p === '/out/root' ||
        p.startsWith('/project/Public')
      )
    })
    ;(fs.statSync as any).mockImplementation((p: string) => ({
      isDirectory: () => p === '/project/Public'
    }))
    ;(fs.readdirSync as any).mockImplementation((p: string) => {
      if (p === '/project/Public') return ['logo.svg']
      return []
    })
    ;(fs.copyFileSync as any).mockImplementation(() => undefined)

    plugin.apply(compiler as any)

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/project/Public/logo.svg',
      '/out/root/logo.svg'
    )
  })
})
