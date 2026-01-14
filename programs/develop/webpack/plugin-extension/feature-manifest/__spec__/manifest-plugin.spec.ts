import {describe, it, expect, vi, beforeEach} from 'vitest'

// Mocks for step plugins used by ManifestPlugin
const applySpy = vi.fn()

vi.mock('../steps/emit-manifest', () => ({
  EmitManifest: vi.fn().mockImplementation((opts) => ({opts, apply: applySpy}))
}))

vi.mock('../steps/check-manifest-files', () => ({
  CheckManifestFiles: vi
    .fn()
    .mockImplementation((opts) => ({opts, apply: applySpy}))
}))

vi.mock('../steps/update-manifest', () => ({
  UpdateManifest: vi
    .fn()
    .mockImplementation((opts) => ({opts, apply: applySpy}))
}))

vi.mock('../steps/add-dependencies', () => ({
  AddDependencies: vi
    .fn()
    .mockImplementation((deps) => ({deps, apply: applySpy}))
}))

vi.mock('../steps/throw-if-recompile', () => ({
  ThrowIfRecompileIsNeeded: vi
    .fn()
    .mockImplementation((opts) => ({opts, apply: applySpy}))
}))

vi.mock('../steps/legacy-warnings', () => ({
  ManifestLegacyWarnings: vi.fn().mockImplementation(() => ({apply: applySpy}))
}))

// Import under test after mocks
import {ManifestPlugin} from '../index'

describe('ManifestPlugin', () => {
  beforeEach(() => {
    applySpy.mockClear()
  })

  it('constructs and applies all step plugins with correct options', () => {
    const compiler: any = {hooks: {}} // passed through to sub-plugins

    const plugin = new ManifestPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'firefox',
      includeList: {icons: 'icons/icon.png'}
    } as any)

    plugin.apply(compiler as any)

    // Ensure each step had apply called
    expect(applySpy).toHaveBeenCalled()
    // Called for each of the current 5 steps (central checks removed)
    expect(applySpy.mock.calls.length).toBe(5)
  })
})

