import {beforeEach, describe, expect, it, vi} from 'vitest'

const toPosix = (value: string) => value.replace(/\\/g, '/')

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

  it('warns when browser_action/theme_icons is missing', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockReturnValue(false)

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        'browser_action/theme_icons': ['/abs/assets/missing.png']
      }
    } as any)

    step.apply(compiler as any)

    expect(compilation.errors.length).toBe(0)
    expect(compilation.warnings.length).toBe(1)
    const w = String(compilation.warnings[0])
    expect(w).toMatch(/NOT FOUND/i)
  })

  const makeCompiler = () => {
    const compilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: Function) => cb()}},
      errors: [],
      warnings: [],
      emitAsset: vi.fn(),
      options: {output: {path: '/abs/out/chrome'}}
    }
    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
      },
      options: {context: '/abs/project'}
    }
    return {compiler, compilation}
  }

  it('emits string icon entries to the correct output folder', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    const existing = new Set([
      '/abs/assets/icon16.png',
      '/abs/assets/icon48.png',
      '/abs/assets/action16.png',
      '/abs/assets/ba16.png',
      '/abs/assets/pa16.png',
      '/abs/assets/sa16.png'
    ])
    FS.existsSync.mockImplementation((p: string) => existing.has(toPosix(p)))

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

  it('preserves manifest-relative paths for in-project icons (G16)', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    const existing = new Set([
      '/abs/project/icons-dev/icon48.png',
      '/abs/project/images/logo.png'
    ])
    FS.existsSync.mockImplementation((p: string) => existing.has(toPosix(p)))

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/project/icons-dev/icon48.png'],
        'action/default_icon': ['/abs/project/images/logo.png']
      }
    } as any)

    step.apply(compiler as any)

    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toContain('icons-dev/icon48.png')
    expect(calls).toContain('images/logo.png')
    expect(calls).not.toContain('icons/icon48.png')
    expect(calls).not.toContain('icons/logo.png')
  })

  it('skips missing files and emits only existing ones', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockImplementation(
      (p: string) => toPosix(p) === '/abs/assets/keep.png'
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

  it('emits theme/images entries to the theme/images folder', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockImplementation(
      (p: string) =>
        p === '/abs/assets/weta.png' || p === '/abs/assets/weta-left.png'
    )

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        'theme/images/weta.png': '/abs/assets/weta.png',
        'theme/images/weta-left.png': '/abs/assets/weta-left.png'
      }
    } as any)

    step.apply(compiler as any)

    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toEqual([
      'theme/images/weta.png',
      'theme/images/weta-left.png'
    ])
  })

  it('resolves leading "/" and relative paths from manifest directory (skips public-root)', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockImplementation((p: string) => {
      const normalized = toPosix(p)
      return (
        normalized === '/abs/project/public/icon.png' ||
        normalized === '/abs/project/icons/rel.png'
      )
    })

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

    FS.existsSync.mockImplementation((p: string) =>
      toPosix(p).includes('/public/')
    )

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/project/public/sub/icon.png']
      }
    } as any)

    step.apply(compiler as any)

    expect((compilation.emitAsset as any).mock.calls.length).toBe(0)
  })

  it('errors with a pretty message when a top-level icon file is missing', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockReturnValue(false)

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {icons: ['/abs/assets/missing.png']}
    } as any)

    step.apply(compiler as any)

    expect(compilation.errors.length).toBe(1)
    const e = String(compilation.errors[0])
    expect(e).toMatch(/Check the .* manifest\.json/i)
    expect(e).toMatch(/NOT FOUND/i)
    expect(e).toContain('/abs/assets/missing.png')
  })

  it('shows public-root hint only for extension-root absolute (leading /) paths', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockReturnValue(false)

    let step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {icons: ['/missing.png']}
    } as any)
    step.apply(compiler as any)
    const msg1 = String(compilation.errors[0] || compilation.warnings[0] || '')
    expect(msg1).toMatch(/resolved from the extension output root/i)

    compilation.errors = []
    compilation.warnings = []

    step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {icons: ['icons/missing.png']}
    } as any)
    step.apply(compiler as any)
    const msg2 = String(compilation.errors[0] || compilation.warnings[0] || '')
    expect(msg2).not.toMatch(/resolved from the extension output root/i)
  })

  it('errors when a default_icon family is missing', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockReturnValue(false)

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {'action/default_icon': ['/abs/assets/missing.png']}
    } as any)

    step.apply(compiler as any)

    expect(compilation.errors.length).toBe(1)
    const e = String(compilation.errors[0])
    expect(e).toMatch(/Check the .* manifest\.json/i)
    expect(e).toMatch(/NOT FOUND/i)
    expect(e).toContain('/abs/assets/missing.png')
  })

  it('handles object-shaped icons map: emits existing and errors missing (pre-browser)', async () => {
    const {EmitFile} = await import('../steps/emit-file')
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockImplementation(
      (p: string) => p === '/abs/assets/icon48.png'
    )

    const step = new EmitFile({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: {
          16: '/abs/assets/icon16.png',
          48: '/abs/assets/icon48.png'
        } as any
      }
    } as any)

    step.apply(compiler as any)

    expect(compilation.errors.length).toBe(1)
    const calls = (compilation.emitAsset as any).mock.calls.map(
      (c: any[]) => c[0]
    )
    expect(calls).toEqual(['icons/icon48.png'])
  })
})
