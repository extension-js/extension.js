import {describe, it, expect} from 'vitest'
import {webAccessibleResources} from '../common/web_accessible_resources'

describe('webAccessibleResources override', () => {
  it('drops malformed mv3 entries without resources', () => {
    const manifest = {
      web_accessible_resources: [{matches: ['<all_urls>']}]
    } as any

    const result = webAccessibleResources(manifest)
    expect(result).toBeUndefined()
  })

  it('filters malformed entries and normalizes paths', () => {
    const manifest = {
      web_accessible_resources: [
        {matches: ['<all_urls>'], resources: ['/public/fonts/font.woff2']},
        {matches: ['<all_urls>']}
      ]
    } as any

    const result = webAccessibleResources(manifest) as any
    expect(result.web_accessible_resources).toHaveLength(1)
    expect(result.web_accessible_resources[0].resources).toEqual([
      'fonts/font.woff2'
    ])
  })
})
