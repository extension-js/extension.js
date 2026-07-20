import {describe, expect, it} from 'vitest'
import {getManifestOverrides} from '../../manifest-overrides'

// G14: a cross-browser MV3 manifest that declares BOTH `background.service_worker`
// (Chrome) and `background.scripts` (Firefox) unprefixed. Each per-manifest-version
// override must contribute only its own rewritten key so the aggregate merge keeps
// both, previously the MV3 override re-spread the whole `background`, resetting the
// MV2 override's rewritten `scripts` back to its raw path, so the emitted manifest
// referenced a file no chunk wrote under that name ("not emitted to disk").
describe('getManifestOverrides, dual background keys (G14)', () => {
  it('rewrites BOTH service_worker and scripts to their canonical bundle paths', () => {
    const manifest = {
      manifest_version: 3,
      background: {
        service_worker: 'Background/BackgroundModule.js',
        scripts: ['Background/BackgroundModule.js'],
        type: 'module'
      }
    }

    const parsed = JSON.parse(
      getManifestOverrides('/m/manifest.json', manifest as any, {} as any)
    )

    expect(parsed.background.service_worker).toBe(
      'background/service_worker.js'
    )
    expect(parsed.background.scripts).toEqual(['background/scripts.js'])
    // Unrelated keys survive the merge.
    expect(parsed.background.type).toBe('module')
  })

  it('still rewrites a single background.scripts (MV2) without touching siblings', () => {
    const manifest = {
      manifest_version: 2,
      background: {scripts: ['a.js', 'b.js'], persistent: false}
    }

    const parsed = JSON.parse(
      getManifestOverrides('/m/manifest.json', manifest as any, {} as any)
    )

    expect(parsed.background.scripts).toEqual(['background/scripts.js'])
    expect(parsed.background.persistent).toBe(false)
    expect(parsed.background.service_worker).toBeUndefined()
  })
})
