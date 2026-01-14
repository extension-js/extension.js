import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('@rspack/core', () => ({
  Compilation: {PROCESS_ASSETS_STAGE_ADDITIONS: 0}
}))

const FS = {
  existsSync: vi.fn()
}
vi.mock('fs', () => ({
  ...FS
}))

describe('AddToFileDependencies step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeCompiler = () => {
    const fileDependencies = new Set<string>()
    const compilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: Function) => cb()}},
      errors: [],
      fileDependencies
    }
    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
      }
    }
    return {compiler, compilation}
  }

  it('adds existing file paths to compilation.fileDependencies once', async () => {
    const {AddToFileDependencies} = await import(
      '../steps/add-to-file-dependencies'
    )
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockReturnValue(true)

    const step = new AddToFileDependencies({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/assets/a.png', '/abs/assets/b.png']
      }
    } as any)

    step.apply(compiler as any)

    expect(Array.from(compilation.fileDependencies)).toEqual([
      '/abs/assets/a.png',
      '/abs/assets/b.png'
    ])

    // Applying again should not duplicate entries
    step.apply(compiler as any)
    expect(Array.from(compilation.fileDependencies)).toEqual([
      '/abs/assets/a.png',
      '/abs/assets/b.png'
    ])
  })

  it('skips non-existing files', async () => {
    const {AddToFileDependencies} = await import(
      '../steps/add-to-file-dependencies'
    )
    const {compiler, compilation} = makeCompiler()

    FS.existsSync.mockImplementation(
      (p: string) => p === '/abs/assets/keep.png'
    )

    const step = new AddToFileDependencies({
      manifestPath: '/abs/project/manifest.json',
      includeList: {
        icons: ['/abs/assets/skip.png', '/abs/assets/keep.png']
      }
    } as any)

    step.apply(compiler as any)

    expect(Array.from(compilation.fileDependencies)).toEqual([
      '/abs/assets/keep.png'
    ])
  })
})

