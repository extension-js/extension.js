import {beforeEach, describe, expect, it, vi} from 'vitest'

const applied = vi.hoisted(() => [] as Array<{step: string; options: unknown}>)

// Each step is replaced by a recorder, so the spec reads which steps the
// plugin applies, in which order, and what each one is handed.
const recorder = vi.hoisted(() => (step: string) => {
  return class {
    private readonly options: unknown

    constructor(options?: unknown) {
      this.options = options
    }

    apply() {
      applied.push({step, options: this.options})
    }
  }
})

vi.mock('../steps/emit-manifest', () => ({
  EmitManifest: recorder('EmitManifest')
}))

vi.mock('../steps/validate-theme-values', () => ({
  ValidateThemeArrays: recorder('ValidateThemeArrays')
}))

vi.mock('../steps/update-manifest', () => ({
  UpdateManifest: recorder('UpdateManifest')
}))

vi.mock('../../feature-web-resources/steps/patch-war', () => ({
  PatchWAR: recorder('PatchWAR')
}))

vi.mock('../steps/apply-dev-defaults', () => ({
  ApplyDevDefaults: recorder('ApplyDevDefaults')
}))

vi.mock('../steps/warn-undeclared-permissions', () => ({
  WarnUndeclaredPermissions: recorder('WarnUndeclaredPermissions')
}))

vi.mock('../steps/persist-manifest', () => ({
  PersistManifestToDisk: recorder('PersistManifestToDisk')
}))

vi.mock('../steps/warn-description-length', () => ({
  WarnDescriptionLength: recorder('WarnDescriptionLength')
}))

vi.mock('../steps/warn-ignored-host-permissions', () => ({
  WarnIgnoredHostPermissions: recorder('WarnIgnoredHostPermissions')
}))

vi.mock('../steps/warn-content-script-host-access', () => ({
  WarnContentScriptHostAccess: recorder('WarnContentScriptHostAccess')
}))

vi.mock('../steps/add-dependencies', () => ({
  AddDependencies: recorder('AddDependencies')
}))

vi.mock('../steps/legacy-warnings', () => ({
  ManifestLegacyWarnings: recorder('ManifestLegacyWarnings')
}))

vi.mock('../steps/warn-webassembly', () => ({
  WarnWebAssembly: recorder('WarnWebAssembly')
}))

import {ManifestPlugin} from '../index'

const manifestPath = '/abs/path/manifest.json'

describe('ManifestPlugin', () => {
  beforeEach(() => {
    applied.length = 0
  })

  // Steps that share a processAssets stage run in the order they are
  // applied, so the order here is part of how the manifest is built.
  it('applies every step once, writers before the checks that read them', () => {
    new ManifestPlugin({manifestPath, browser: 'firefox'}).apply({
      hooks: {}
    } as never)

    expect(applied.map((entry) => entry.step)).toEqual([
      'EmitManifest',
      'ValidateThemeArrays',
      'UpdateManifest',
      'PatchWAR',
      'ApplyDevDefaults',
      'WarnUndeclaredPermissions',
      'PersistManifestToDisk',
      'WarnDescriptionLength',
      'WarnIgnoredHostPermissions',
      'WarnContentScriptHostAccess',
      'WarnWebAssembly',
      'AddDependencies',
      'ManifestLegacyWarnings'
    ])
  })

  it('hands each step the manifest path, the browser and the session flag it needs', () => {
    new ManifestPlugin({
      manifestPath,
      browser: 'firefox',
      devSession: false
    }).apply({hooks: {}} as never)

    const optionsOf = (step: string) =>
      applied.find((entry) => entry.step === step)?.options

    expect(optionsOf('EmitManifest')).toEqual({
      manifestPath,
      browser: 'firefox'
    })

    expect(optionsOf('UpdateManifest')).toEqual({
      manifestPath,
      browser: 'firefox'
    })

    expect(optionsOf('PatchWAR')).toEqual({manifestPath, browser: 'firefox'})
    expect(optionsOf('ApplyDevDefaults')).toEqual({
      manifestPath,
      browser: 'firefox',
      devSession: false
    })

    expect(optionsOf('WarnUndeclaredPermissions')).toEqual({
      manifestPath,
      browser: 'firefox',
      devSession: false
    })

    expect(optionsOf('PersistManifestToDisk')).toEqual({manifestPath})
    expect(optionsOf('WarnDescriptionLength')).toEqual({browser: 'firefox'})
    expect(optionsOf('WarnWebAssembly')).toEqual({browser: 'firefox'})
    expect(optionsOf('AddDependencies')).toEqual([manifestPath])
  })

  it('builds for chrome when no browser is named', () => {
    const plugin = new ManifestPlugin({manifestPath} as never)
    plugin.apply({hooks: {}} as never)

    expect(plugin.browser).toBe('chrome')
    expect(
      applied.find((entry) => entry.step === 'EmitManifest')?.options
    ).toEqual({manifestPath, browser: 'chrome'})
  })
})
