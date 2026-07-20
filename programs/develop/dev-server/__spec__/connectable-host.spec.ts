import {describe, expect, it} from 'vitest'
import {isWildcardHost, resolveConnectableHost} from '../connectable-host'

describe('resolveConnectableHost', () => {
  it('keeps a concrete bind host as-is (it is already connectable)', () => {
    expect(resolveConnectableHost('192.168.1.50')).toBe('192.168.1.50')
    expect(resolveConnectableHost('my-host.local')).toBe('my-host.local')
    expect(resolveConnectableHost('127.0.0.1')).toBe('127.0.0.1')
  })

  it('rewrites a wildcard bind host to loopback (the devcontainer case)', () => {
    expect(resolveConnectableHost('0.0.0.0')).toBe('127.0.0.1')
    expect(resolveConnectableHost('::')).toBe('127.0.0.1')
    expect(resolveConnectableHost('')).toBe('127.0.0.1')
    expect(resolveConnectableHost(undefined)).toBe('127.0.0.1')
  })

  it('an explicit publicHost override always wins (the true-remote case)', () => {
    expect(resolveConnectableHost('0.0.0.0', 'devbox.example.com')).toBe(
      'devbox.example.com'
    )
    expect(resolveConnectableHost('192.168.1.50', 'public.example.com')).toBe(
      'public.example.com'
    )
  })

  it('ignores a blank/whitespace publicHost', () => {
    expect(resolveConnectableHost('0.0.0.0', '   ')).toBe('127.0.0.1')
    expect(resolveConnectableHost('10.0.0.2', '')).toBe('10.0.0.2')
  })

  it('isWildcardHost flags only unspecified/wildcard addresses', () => {
    for (const h of ['0.0.0.0', '::', '[::]', '*', '']) {
      expect(isWildcardHost(h)).toBe(true)
    }
    for (const h of ['127.0.0.1', '192.168.0.1', 'host.local']) {
      expect(isWildcardHost(h)).toBe(false)
    }
  })
})
