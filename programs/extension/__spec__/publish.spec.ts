import {describe, it, expect, afterEach} from 'vitest'
import {buildPublishRequest} from '../commands/publish'

const ORIG = {...process.env}
afterEach(() => {
  process.env = {...ORIG}
})

describe('buildPublishRequest', () => {
  it('throws a helpful error when no token is set', () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(() => buildPublishRequest({})).toThrow(/EXTENSION_DEV_TOKEN/)
  })

  it('uses --token, default API base, and a Bearer header', () => {
    const req = buildPublishRequest({token: 'tok_abc'})
    expect(req.url).toBe('https://www.extension.dev/api/cli/publish')
    expect(req.headers.authorization).toBe('Bearer tok_abc')
    expect(req.headers['content-type']).toBe('application/json')
    expect(JSON.parse(req.body)).toEqual({})
  })

  it('reads the token from EXTENSION_DEV_TOKEN and api from EXTENSION_DEV_API_URL', () => {
    process.env.EXTENSION_DEV_TOKEN = 'tok_env'
    process.env.EXTENSION_DEV_API_URL = 'http://localhost:3000/'
    const req = buildPublishRequest({})
    expect(req.url).toBe('http://localhost:3000/api/cli/publish') // trailing slash trimmed
    expect(req.headers.authorization).toBe('Bearer tok_env')
  })

  it('includes ttlHours and buildSha in the body when provided', () => {
    const req = buildPublishRequest({token: 't', ttl: '48', buildSha: 'abc123'})
    expect(JSON.parse(req.body)).toEqual({ttlHours: 48, buildSha: 'abc123'})
  })

  it('--token overrides the env token', () => {
    process.env.EXTENSION_DEV_TOKEN = 'env'
    expect(buildPublishRequest({token: 'flag'}).headers.authorization).toBe(
      'Bearer flag'
    )
  })
})
