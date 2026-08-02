import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {buildPublishRequest} from '../commands/publish'

const ORIG = {...process.env}
let configDir = ''

// Point both the XDG and Windows lookups at a private temp dir so no test
// can read the developer's real stored login.
beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-auth-'))
  process.env.XDG_CONFIG_HOME = configDir
  process.env.APPDATA = configDir
  delete process.env.EXTENSION_DEV_TOKEN
})

afterEach(() => {
  process.env = {...ORIG}
  fs.rmSync(configDir, {recursive: true, force: true})
})

function writeAuthFile(contents: string) {
  const dir = path.join(configDir, 'extension-dev')
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'auth.json'), contents)
}

function writeStoredLogin(token: string, extra: Record<string, unknown> = {}) {
  writeAuthFile(JSON.stringify({version: 1, token, ...extra}))
}

describe('buildPublishRequest', () => {
  it('throws a helpful error when no token is set', () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(() => buildPublishRequest({})).toThrow(/EXTENSION_DEV_TOKEN/)
  })

  it('names an openable docs URL when no token is set', () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(() => buildPublishRequest({})).toThrow(
      /https:\/\/docs\.extension\.dev\/tools\/publish/
    )
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
    expect(req.url).toBe('http://localhost:3000/api/cli/publish')
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

describe('stored device login fallback', () => {
  it('--token wins over the env var and the stored login', () => {
    process.env.EXTENSION_DEV_TOKEN = 'tok_env'
    writeStoredLogin('tok_stored')
    expect(buildPublishRequest({token: 'tok_flag'}).headers.authorization).toBe(
      'Bearer tok_flag'
    )
  })

  it('the env var wins over the stored login', () => {
    process.env.EXTENSION_DEV_TOKEN = 'tok_env'
    writeStoredLogin('tok_stored')
    expect(buildPublishRequest({}).headers.authorization).toBe('Bearer tok_env')
  })

  it('uses the stored login when it is the only token source', () => {
    writeStoredLogin('tok_stored')
    expect(buildPublishRequest({}).headers.authorization).toBe(
      'Bearer tok_stored'
    )
  })

  it('ignores a stored login that has expired', () => {
    writeStoredLogin('tok_stored', {
      expiresAt: Math.floor(Date.now() / 1000) - 60
    })
    expect(() => buildPublishRequest({})).toThrow(/No token/)
  })

  it('a malformed auth.json falls through to the refusal', () => {
    writeAuthFile('{not json at all')
    expect(() => buildPublishRequest({})).toThrow(/No token/)
  })

  it('an auth.json with an unknown version falls through to the refusal', () => {
    writeAuthFile(JSON.stringify({version: 2, token: 'tok_future'}))
    expect(() => buildPublishRequest({})).toThrow(/No token/)
  })

  it('an absent auth.json falls through to the refusal', () => {
    expect(() => buildPublishRequest({})).toThrow(/No token/)
  })

  it('the refusal names the flag, the env var, and the login command', () => {
    let message = ''
    try {
      buildPublishRequest({})
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('--token')
    expect(message).toContain('EXTENSION_DEV_TOKEN')
    expect(message).toContain('npx @extension.dev/mcp login')
  })
})
