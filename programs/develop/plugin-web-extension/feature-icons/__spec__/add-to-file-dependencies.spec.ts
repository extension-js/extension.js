import {beforeEach, describe, expect, it, vi} from 'vitest'
import {asCompiler, type TapCallback} from '../../__spec__/helpers/rspack-fakes'

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
    const compilation: {
      hooks: unknown
      errors: Error[]
      fileDependencies: Set<string>
      missingDependencies?: Set<string>
    } = {
      hooks: {processAssets: {tap: (_: unknown, cb: TapCallback) => cb()}},
      errors: [],
      fileDependencies
    }
    const compiler = asCompiler({
      hooks: {
        thisCompilation: {tap: (_: string, cb: TapCallback) => cb(compilation)}
      }
    })

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
    } as ConstructorParameters<typeof AddToFileDependencies>[0])

    step.apply(asCompiler(compiler))

    expect(Array.from(compilation.fileDependencies)).toEqual([
      '/abs/assets/a.png',
      '/abs/assets/b.png'
    ])

    step.apply(asCompiler(compiler))
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
    } as ConstructorParameters<typeof AddToFileDependencies>[0])

    step.apply(asCompiler(compiler))

    expect(Array.from(compilation.fileDependencies)).toEqual([
      '/abs/assets/keep.png'
    ])
  })

  it('keeps tracking when the compilation already has errors', async () => {
    const {AddToFileDependencies} = await import(
      '../steps/add-to-file-dependencies'
    )
    const {compiler, compilation} = makeCompiler()
    compilation.errors.push(new Error('earlier failure'))
    FS.existsSync.mockReturnValue(true)
    new AddToFileDependencies({
      manifestPath: '/abs/project/manifest.json',
      includeList: {icons: ['/abs/assets/a.png']}
    } as ConstructorParameters<typeof AddToFileDependencies>[0]).apply(
      asCompiler(compiler)
    )

    expect(Array.from(compilation.fileDependencies)).toEqual([
      '/abs/assets/a.png'
    ])
  })

  it('remembers a missing icon so its arrival rebuilds', async () => {
    const {AddToFileDependencies} = await import(
      '../steps/add-to-file-dependencies'
    )
    const {compiler, compilation} = makeCompiler()
    compilation.missingDependencies = new Set<string>()
    FS.existsSync.mockReturnValue(false)
    new AddToFileDependencies({
      manifestPath: '/abs/project/manifest.json',
      includeList: {icons: ['/abs/assets/gone.png']}
    } as ConstructorParameters<typeof AddToFileDependencies>[0]).apply(
      asCompiler(compiler)
    )

    expect(compilation.fileDependencies.size).toBe(0)
    expect(Array.from(compilation.missingDependencies)).toEqual([
      '/abs/assets/gone.png'
    ])
  })
})
