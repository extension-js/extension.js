import {describe, it, expect, vi} from 'vitest'
import {getManifestOverrides} from '../../manifest-overrides'

vi.spyOn(require('fs'), 'readFileSync').mockImplementation(() => '{"name":"x"}')

vi.mock('../common', () => ({
  manifestCommon: () => ({background: {page: 'bg.html'}, icons: {}})
}))
vi.mock('../mv2', () => ({
  manifestV2: () => ({background: {scripts: ['bg.js']}, page_action: {}})
}))
vi.mock('../mv3', () => ({
  manifestV3: () => ({background: {service_worker: 'sw.js'}, action: {}})
}))

describe('getManifestOverrides', () => {
  it('merges background contributions and stringifies result', () => {
    const result = getManifestOverrides(
      '/m/manifest.json',
      {name: 'x'} as any,
      {}
    )
    const parsed = JSON.parse(result)

    expect(parsed.background).toEqual({
      page: 'bg.html',
      scripts: ['bg.js'],
      service_worker: 'sw.js'
    })
    expect(parsed.name).toBe('x')
  })
})

