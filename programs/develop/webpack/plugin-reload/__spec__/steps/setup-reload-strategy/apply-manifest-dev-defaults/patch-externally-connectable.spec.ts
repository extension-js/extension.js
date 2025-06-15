import {describe, it, expect} from 'vitest'
import patchExternallyConnectable from '../../../../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-externally-connectable'
import {type Manifest} from '../../../../../webpack-types'

describe('patch-externally-connectable', () => {
  it('should add wildcard ID when externally_connectable exists but has no ids', () => {
    const manifest = {
      externally_connectable: {
        matches: ['<all_urls>']
      }
    } as Manifest
    const result = patchExternallyConnectable(manifest)
    expect(result).toEqual({
      externally_connectable: {
        matches: ['<all_urls>'],
        ids: ['*']
      }
    })
  })

  it('should add wildcard ID to existing ids array', () => {
    const manifest = {
      externally_connectable: {
        matches: ['<all_urls>'],
        ids: ['extension1', 'extension2']
      }
    } as Manifest
    const result = patchExternallyConnectable(manifest)
    expect(result).toEqual({
      externally_connectable: {
        matches: ['<all_urls>'],
        ids: ['extension1', 'extension2', '*']
      }
    })
  })

  it('should not modify externally_connectable if it already has wildcard ID', () => {
    const manifest = {
      externally_connectable: {
        matches: ['<all_urls>'],
        ids: ['*']
      }
    } as Manifest
    const result = patchExternallyConnectable(manifest)
    expect(result).toEqual({})
  })

  it('should return empty object when externally_connectable is not present', () => {
    const manifest = {} as Manifest
    const result = patchExternallyConnectable(manifest)
    expect(result).toEqual({})
  })

  it('should handle empty ids array', () => {
    const manifest = {
      externally_connectable: {
        matches: ['<all_urls>'],
        ids: []
      }
    } as Manifest
    const result = patchExternallyConnectable(manifest)
    expect(result).toEqual({
      externally_connectable: {
        matches: ['<all_urls>'],
        ids: ['*']
      }
    })
  })
})
