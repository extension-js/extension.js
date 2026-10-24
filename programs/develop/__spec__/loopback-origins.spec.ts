import {describe, expect, it} from 'vitest'
import {findLoopbackOrigins, isLoopbackPattern} from '../lib/loopback-origins'

describe('loopback origins in a manifest', () => {
  it('recognizes every loopback host form', () => {
    for (const pattern of [
      'http://localhost:4322/*',
      'https://localhost/*',
      'http://app.localhost/*',
      'http://127.0.0.1:8080/*',
      'http://127.12.0.9/*',
      'http://[::1]:3000/*',
      'http://0.0.0.0/*',
      '*://localhost/*'
    ]) {
      expect(isLoopbackPattern(pattern), pattern).toBe(true)
    }
  })

  it('leaves real hosts and non-URL entries alone', () => {
    for (const pattern of [
      'https://example.com/*',
      'https://localhost.example.com/*',
      'https://mylocalhost/*',
      '<all_urls>',
      'storage',
      'http://128.0.0.1/*'
    ]) {
      expect(isLoopbackPattern(pattern), pattern).toBe(false)
    }
  })

  it('names each loopback pattern with where it sits', () => {
    const origins = findLoopbackOrigins({
      manifest_version: 3,
      content_scripts: [
        {matches: ['https://example.com/*']},
        {matches: ['https://leon.example/*', 'http://localhost:4322/*']}
      ],
      host_permissions: ['http://127.0.0.1/*', 'https://api.example.com/*'],
      optional_host_permissions: ['http://[::1]/*'],
      externally_connectable: {matches: ['http://localhost:3000/*']},
      web_accessible_resources: [
        {resources: ['a.png'], matches: ['http://0.0.0.0/*']}
      ]
    })

    expect(origins).toEqual([
      {pattern: 'http://localhost:4322/*', where: 'content_scripts[1].matches'},
      {pattern: 'http://127.0.0.1/*', where: 'host_permissions'},
      {pattern: 'http://[::1]/*', where: 'optional_host_permissions'},
      {
        pattern: 'http://localhost:3000/*',
        where: 'externally_connectable.matches'
      },
      {
        pattern: 'http://0.0.0.0/*',
        where: 'web_accessible_resources[0].matches'
      }
    ])
  })

  it('reads Manifest V2 host patterns among the permissions', () => {
    expect(
      findLoopbackOrigins({
        manifest_version: 2,
        permissions: ['storage', 'http://localhost/*']
      })
    ).toEqual([{pattern: 'http://localhost/*', where: 'permissions'}])
  })

  it('returns nothing for a clean or malformed manifest', () => {
    expect(
      findLoopbackOrigins({content_scripts: [{matches: ['https://a.b/*']}]})
    ).toEqual([])

    expect(findLoopbackOrigins(null)).toEqual([])
    expect(findLoopbackOrigins({content_scripts: 'nope'})).toEqual([])
  })
})
