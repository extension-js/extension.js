import {beforeEach, describe, expect, it, vi} from 'vitest'

const applySpy = vi.fn()

vi.mock('../steps/emit-manifest', () => ({
  EmitManifest: class {
    constructor(_opts: any) {}
    apply = applySpy
  }
}))

vi.mock('../steps/update-manifest', () => ({
  UpdateManifest: class {
    constructor(_opts: any) {}
    apply = applySpy
  }
}))

vi.mock('../steps/patch-war', () => ({
  PatchWAR: class {
    constructor(_opts: any) {}
    apply = applySpy
  }
}))
vi.mock('../steps/apply-dev-defaults', () => ({
  ApplyDevDefaults: class {
    constructor(_opts: any) {}
    apply = applySpy
  }
}))
vi.mock('../steps/persist-manifest', () => ({
  PersistManifestToDisk: class {
    apply = applySpy
  }
}))

vi.mock('../steps/add-dependencies', () => ({
  AddDependencies: class {
    constructor(_deps: any) {}
    apply = applySpy
  }
}))

vi.mock('../steps/legacy-warnings', () => ({
  ManifestLegacyWarnings: class {
    apply = applySpy
  }
}))

import {ManifestPlugin} from '../index'

describe('ManifestPlugin', () => {
  beforeEach(() => {
    applySpy.mockClear()
  })

  it('constructs and applies all step plugins with correct options', () => {
    const compiler: any = {hooks: {}}

    const plugin = new ManifestPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'firefox',
      includeList: {icons: 'icons/icon.png'}
    } as any)

    plugin.apply(compiler as any)

    expect(applySpy).toHaveBeenCalled()
    expect(applySpy.mock.calls.length).toBe(7)
  })
})
