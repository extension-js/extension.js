import {describe, expect, it} from 'vitest'
import {getManifestOverrides} from '../../manifest-overrides'

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
