import {describe, expect, it} from 'vitest'
import {declarativeNetRequest} from '../declarative_net_request'

describe('declarativeNetRequest (MV3 override)', () => {
  it('rewrites rule_resources paths to canonical output paths', () => {
    const result = declarativeNetRequest({
      manifest_version: 3,
      declarative_net_request: {
        rule_resources: [
          {
            id: 'ruleset_1',
            enabled: true,
            path: 'rules/block.json'
          }
        ]
      }
    } as any)

    expect(result).toEqual({
      declarative_net_request: {
        rule_resources: [
          {
            id: 'ruleset_1',
            enabled: true,
            path: 'declarative_net_request/ruleset_1.json'
          }
        ]
      }
    })
  })

  it('does not throw when declarative_net_request has no rule_resources (dynamic-only)', () => {
    const result = declarativeNetRequest({
      manifest_version: 3,
      declarative_net_request: {}
    } as any)

    expect(result).toEqual({
      declarative_net_request: {}
    })
  })

  it('does not throw when rule_resources is undefined', () => {
    const result = declarativeNetRequest({
      manifest_version: 3,
      declarative_net_request: {
        rule_resources: undefined
      }
    } as any)

    expect(result).toEqual({
      declarative_net_request: {
        rule_resources: undefined
      }
    })
  })

  it('preserves empty rule_resources arrays', () => {
    const result = declarativeNetRequest({
      manifest_version: 3,
      declarative_net_request: {
        rule_resources: []
      }
    } as any)

    expect(result).toEqual({
      declarative_net_request: {
        rule_resources: []
      }
    })
  })

  it('returns undefined when manifest has no declarative_net_request', () => {
    const result = declarativeNetRequest({manifest_version: 3} as any)
    expect(result).toBeUndefined()
  })

  it('preserves other declarative_net_request fields alongside rewritten paths', () => {
    const result = declarativeNetRequest({
      manifest_version: 3,
      declarative_net_request: {
        rule_resources: [
          {id: 'ruleset_a', enabled: false, path: 'src/rules/a.json'}
        ]
      }
    } as any)

    expect(result?.declarative_net_request?.rule_resources?.[0]).toEqual({
      id: 'ruleset_a',
      enabled: false,
      path: 'declarative_net_request/ruleset_a.json'
    })
  })
})
