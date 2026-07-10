import {describe, it, expect} from 'vitest'
import {diagnoseChromiumManifestRefusal} from '../browsers-lib/manifest-refusal'

// Launch-time honesty for manifest shapes Chromium refuses to load AT ALL:
// the refusal surfaces as a native modal or as nothing (no console error, no
// CDP target), so dev must say why before the spawn. MV2 was already
// diagnosed; Firefox-style MV3 `background.scripts` without a service_worker
// is the second shape (MelonTranslate / spotify-hotkeys-firefox cluster).
describe('diagnoseChromiumManifestRefusal', () => {
  it('flags MV2', () => {
    expect(diagnoseChromiumManifestRefusal({manifest_version: 2})).toBe('mv2')
  })

  it('flags MV3 with Firefox-style background.scripts and no service_worker', () => {
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {scripts: ['background.js']}
      })
    ).toBe('mv3-background-scripts')
  })

  it('accepts MV3 with a service_worker (even alongside scripts)', () => {
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {service_worker: 'sw.js'}
      })
    ).toBeNull()
    // Dual-declared manifests load on Chromium (it uses the worker) — the
    // scripts array is Firefox's half of a cross-browser manifest.
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {service_worker: 'sw.js', scripts: ['background.js']}
      })
    ).toBeNull()
  })

  it('accepts MV3 with no background and tolerates malformed shapes', () => {
    expect(diagnoseChromiumManifestRefusal({manifest_version: 3})).toBeNull()
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {scripts: []}
      })
    ).toBeNull()
    expect(diagnoseChromiumManifestRefusal(undefined)).toBeNull()
    expect(
      diagnoseChromiumManifestRefusal({manifest_version: 3, background: 'x'})
    ).toBeNull()
  })
})
