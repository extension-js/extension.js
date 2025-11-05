import {describe, it, expect, vi, beforeEach} from 'vitest'

// Minimal mock of @rspack/core pieces used in the step
vi.mock('@rspack/core', () => {
  class RawSource {
    private _buf: any
    constructor(buf: any) {
      this._buf = buf
    }
    source() {
      return this._buf
    }
  }
  class WebpackError extends Error {}
  return {
    default: {WebpackError},
    WebpackError,
    Compilation: {PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER: 0},
    sources: {RawSource}
  }
})

// Mock fs and path resolution behavior at the API boundaries we use
const FS = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from('file-bytes'))
}
vi.mock('fs', () => ({
  ...FS
}))

describe('EmitFile step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeCompiler = () => {
    const compilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: Function) => cb()}},
      errors: [],
      warnings: [],
      emitAsset: vi.fn()
    }
    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
      }
    }
    return {compiler, compilation}
  }

  it('emits string icon entries to the correct output folder', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    // Treat only the provided includeList paths as existing
    const existing = new Set([
      '/abs/assets/icon16.png',
      '/abs/assets/icon48.png',
      '/abs/assets/action16.png',
      '/abs/assets/ba16.png',
      '/abs/assets/pa16.png',
      '/abs/assets/sa16.png'
    ])
    FS.existsSync.mockImplementation((p: string) => existing.has(p))

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/assets/icon16.png', '/abs/assets/icon48.png'],
        'action/default_icon': ['/abs/assets/action16.png'],
        'browser_action/default_icon': ['/abs/assets/ba16.png'],
        'page_action/default_icon': ['/abs/assets/pa16.png'],
        'sidebar_action/default_icon': ['/abs/assets/sa16.png']
      }
    } as any)

    step.apply(compiler as any)

    // Expect emitted assets with normalized destination folders
    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toContain('icons/icon16.png')
    expect(calls).toContain('icons/icon48.png')
    expect(calls).toContain('icons/action16.png')
    expect(calls).toContain('icons/ba16.png')
    expect(calls).toContain('icons/pa16.png')
    expect(calls).toContain('icons/sa16.png')
  })

  it('skips missing files and emits only existing ones', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    // Only one path exists
    FS.existsSync.mockImplementation(
      (p: string) => p === '/abs/assets/keep.png'
    )

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/assets/skip.png', '/abs/assets/keep.png']
      }
    } as any)

    step.apply(compiler as any)

    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toEqual(['icons/keep.png'])
  })

  it('emits browser_action/theme_icons to browser_action folder', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockImplementation(
      (p: string) => p === '/abs/assets/a.png' || p === '/abs/assets/b.png'
    )

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        'browser_action/theme_icons': ['/abs/assets/a.png', '/abs/assets/b.png']
      }
    } as any)

    step.apply(compiler as any)

    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toEqual(['browser_action/a.png', 'browser_action/b.png'])
  })

  it('resolves leading "/" and relative paths from manifest directory (skips public-root)', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    // Only the resolved forms should exist
    FS.existsSync.mockImplementation(
      (p: string) =>
        p === '/abs/project/public/icon.png' ||
        p === '/abs/project/icons/rel.png'
    )

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        'action/default_icon': ['/public/icon.png', 'icons/rel.png']
      }
    } as any)

    step.apply(compiler as any)

    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toEqual(['icons/rel.png'])
  })

  it('skips assets under public/', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    // Simulate an icon under public/
    FS.existsSync.mockImplementation((p: string) => p.includes('/public/'))

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/project/public/sub/icon.png']
      }
    } as any)

    step.apply(compiler as any)

    expect((compilation.emitAsset as any).mock.calls.length).toBe(0)
  })

  it('warns with a pretty message when an included file is missing', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    // No file exists
    FS.existsSync.mockReturnValue(false)

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {icons: ['/abs/assets/missing.png']}
    } as any)

    step.apply(compiler as any)

    expect(compilation.warnings.length).toBe(1)
    const w = String(compilation.warnings[0])
    expect(w).toMatch(/Check the .* manifest\.json/i)
    expect(w).toMatch(/NOT FOUND/i)
    expect(w).toContain('/abs/assets/missing.png')
  })
})
