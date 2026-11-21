import {beforeEach, describe, expect, it, vi} from 'vitest'
import {asCompiler} from '../../__spec__/helpers/rspack-fakes'

const EmitFileMock = vi.fn(function (this: {apply?: unknown}, _opts: unknown) {
  this.apply = vi.fn()
})
const AddToFileDependenciesMock = vi.fn(function (
  this: {apply?: unknown},
  _opts: unknown
) {
  this.apply = vi.fn()
})

vi.mock('../steps/emit-file', () => ({
  EmitFile: EmitFileMock
}))

vi.mock('../steps/add-to-file-dependencies', () => ({
  AddToFileDependencies: AddToFileDependenciesMock
}))

describe('IconsPlugin (index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs steps with provided options and calls apply on each', async () => {
    const {IconsPlugin} = await import('..')

    const options = {
      manifestPath: '/project/manifest.json',
      includeList: {icons: ['/icons/a.png']}
    }

    const plugin = new IconsPlugin(options)
    const fakeCompiler = asCompiler({
      hooks: {
        watchRun: {tapAsync: vi.fn()},
        thisCompilation: {tap: vi.fn()}
      }
    })

    plugin.apply(fakeCompiler)

    expect(EmitFileMock).toHaveBeenCalledTimes(1)
    expect(AddToFileDependenciesMock).toHaveBeenCalledTimes(1)

    const emitCtorArgs = EmitFileMock.mock.calls[0][0]
    const depsCtorArgs = AddToFileDependenciesMock.mock.calls[0][0]
    expect(emitCtorArgs).toEqual(options)
    expect(depsCtorArgs).toEqual(options)

    const emitInstance = EmitFileMock.mock.instances[0]
    const depsInstance = AddToFileDependenciesMock.mock.instances[0]
    expect(emitInstance.apply).toHaveBeenCalledWith(fakeCompiler)
    expect(depsInstance.apply).toHaveBeenCalledWith(fakeCompiler)
  })
})
