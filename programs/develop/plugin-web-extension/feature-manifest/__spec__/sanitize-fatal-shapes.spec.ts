import {describe, it, expect} from 'vitest'
import {sanitizeFatalManifestShapes} from '../manifest-lib/sanitize-fatal-shapes'
import {type Manifest} from '../../../types'

describe('sanitizeFatalManifestShapes', () => {
  it('coerces a numeric version to a string', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x',
      version: 1
    } as unknown as Manifest)
    expect(manifest.version).toBe('1')
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('version')
  })

  it('removes an empty-string default_icon from action', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x',
      version: '1.0',
      action: {default_popup: 'index.html', default_icon: ''}
    } as unknown as Manifest)
    expect((manifest as any).action.default_icon).toBeUndefined()
    expect((manifest as any).action.default_popup).toBe('index.html')
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('action.default_icon')
  })

  it('removes an empty-object default_icon from browser_action (MV2)', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 2,
      name: 'x',
      version: '1.0',
      browser_action: {default_icon: {}}
    } as unknown as Manifest)
    expect((manifest as any).browser_action.default_icon).toBeUndefined()
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('browser_action.default_icon')
  })

  it('keeps a valid default_icon and string version untouched', () => {
    const input = {
      manifest_version: 3,
      name: 'x',
      version: '2.3.4',
      action: {default_icon: {'16': 'icon16.png'}}
    } as unknown as Manifest
    const {manifest, fixes} = sanitizeFatalManifestShapes(input)
    expect(fixes).toHaveLength(0)
    expect(manifest.version).toBe('2.3.4')
    expect((manifest as any).action.default_icon).toEqual({'16': 'icon16.png'})
  })

  it('fixes both shapes in one pass (wild subject shape)', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'Leads tracker',
      version: 1,
      action: {default_popup: 'index.html', default_icon: ''}
    } as unknown as Manifest)
    expect(manifest.version).toBe('1')
    expect((manifest as any).action.default_icon).toBeUndefined()
    expect(fixes).toHaveLength(2)
  })
})
