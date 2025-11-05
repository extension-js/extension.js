import {describe, it, expect, vi, beforeEach} from 'vitest'

// Mock step classes so we can assert construction and apply() calls
const EmitFileMock = vi.fn().mockImplementation(function (
  this: any,
  _opts: any
) {
  this.apply = vi.fn()
})
const AddToFileDependenciesMock = vi.fn().mockImplementation(function (
  this: any,
  _opts: any
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
    } as any

    const plugin = new IconsPlugin(options)
    const fakeCompiler: any = {hooks: {}} // not used by this test beyond type

    plugin.apply(fakeCompiler)

    expect(EmitFileMock).toHaveBeenCalledTimes(1)
    expect(AddToFileDependenciesMock).toHaveBeenCalledTimes(1)

    // Ensure options are passed through to both steps
    const emitCtorArgs = EmitFileMock.mock.calls[0][0]
    const depsCtorArgs = AddToFileDependenciesMock.mock.calls[0][0]
    expect(emitCtorArgs).toEqual(options)
    expect(depsCtorArgs).toEqual(options)

    // Ensure each step's apply() was called with the compiler
    const emitInstance = (EmitFileMock as any).mock.instances[0]
    const depsInstance = (AddToFileDependenciesMock as any).mock.instances[0]
    expect(emitInstance.apply).toHaveBeenCalledWith(fakeCompiler)
    expect(depsInstance.apply).toHaveBeenCalledWith(fakeCompiler)
  })
})
