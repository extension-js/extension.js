import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {buildPublishPlan, buildPublishRequest} from '../commands/publish'

const ORIG = {...process.env}
const API = 'https://platform.test'
let configDir = ''

// Point both the XDG and Windows lookups at a private temp dir so no test
// can read the developer's real stored login.
beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-auth-'))
  process.env.XDG_CONFIG_HOME = configDir
  process.env.APPDATA = configDir
  delete process.env.EXTENSION_DEV_TOKEN
  delete process.env.EXTENSION_DEV_DOCS_URL
  process.env.EXTENSION_DEV_API_URL = API
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

  it('names the docs token page only when a docs host is configured', () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(() => buildPublishRequest({})).not.toThrow(/Get a token/)
    process.env.EXTENSION_DEV_DOCS_URL = 'https://docs.platform.test/'
    expect(() => buildPublishRequest({})).toThrow(
      /Get a token: https:\/\/docs\.platform\.test\/tools\/publish/
    )
  })

  it('refuses with the API remedy when no platform URL is configured', () => {
    delete process.env.EXTENSION_DEV_API_URL
    expect(() => buildPublishRequest({token: 'tok_abc'})).toThrow(
      /EXTENSION_DEV_API_URL/
    )
  })

  it('uses --token, the configured API base, and a Bearer header', () => {
    const req = buildPublishRequest({token: 'tok_abc'})
    expect(req.url).toBe('https://platform.test/api/cli/publish')
    expect(req.headers.authorization).toBe('Bearer tok_abc')
    expect(req.headers['content-type']).toBe('application/json')
    expect(JSON.parse(req.body)).toEqual({})
  })

  it('--api wins over EXTENSION_DEV_API_URL', () => {
    const req = buildPublishRequest({
      token: 'tok_abc',
      api: 'http://localhost:4000/'
    })
    expect(req.url).toBe('http://localhost:4000/api/cli/publish')
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

  it('the refusal names the flag, the env var, and the platform login', () => {
    let message = ''
    try {
      buildPublishRequest({})
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('--token')
    expect(message).toContain('EXTENSION_DEV_TOKEN')
    expect(message).toContain('platform MCP')
  })
})

describe('a stored login is scoped to one project', () => {
  let projectDir = ''

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-proj-'))
  })

  afterEach(() => {
    fs.rmSync(projectDir, {recursive: true, force: true})
  })

  function writeProject(name: string) {
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({name, version: '1.0.0'})
    )
  }

  it('refuses when the stored login names a project this directory is not', () => {
    writeStoredLogin('tok_stored', {
      projectSlug: 'xvelte',
      workspaceSlug: 'cezaraugusto'
    })
    writeProject('pubwalk')
    expect(() => buildPublishRequest({projectPath: projectDir})).toThrow(
      /scoped to the "xvelte" project/
    )
  })

  it('the refusal names both projects, the workspace, and every way out', () => {
    writeStoredLogin('tok_stored', {
      projectSlug: 'xvelte',
      workspaceSlug: 'cezaraugusto'
    })
    writeProject('pubwalk')
    let message = ''
    try {
      buildPublishRequest({projectPath: projectDir})
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('xvelte')
    expect(message).toContain('pubwalk')
    expect(message).toContain('cezaraugusto')
    expect(message).toContain('--project xvelte')
    expect(message).toContain('--token')
  })

  it('publishes when the directory is the project the login is scoped to', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    writeProject('xvelte')
    const plan = buildPublishPlan({projectPath: projectDir})
    expect(plan.request.headers.authorization).toBe('Bearer tok_stored')
    expect(plan.scope.actsFor).toBe('xvelte')
    expect(plan.scope.source).toBe('stored-login')
  })

  it('matches a slug against a differently punctuated directory name', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'my-side-panel'})
    writeProject('My Side Panel')
    expect(() => buildPublishRequest({projectPath: projectDir})).not.toThrow()
  })

  it('--project names the scoped project on purpose and proceeds', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    writeProject('pubwalk')
    const plan = buildPublishPlan({
      projectPath: projectDir,
      project: 'xvelte'
    })
    expect(plan.request.headers.authorization).toBe('Bearer tok_stored')
    expect(plan.scope.actsFor).toBe('xvelte')
  })

  it('--project naming a third project is refused, not silently ignored', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    writeProject('pubwalk')
    expect(() =>
      buildPublishRequest({projectPath: projectDir, project: 'something-else'})
    ).toThrow(/stored login is scoped to "xvelte"/)
  })

  it('--token carries its own scope, so the stored login never gates it', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    writeProject('pubwalk')
    const plan = buildPublishPlan({projectPath: projectDir, token: 'tok_flag'})
    expect(plan.request.headers.authorization).toBe('Bearer tok_flag')
    expect(plan.scope.source).toBe('flag')
    expect(plan.scope.actsFor).toBe('pubwalk')
  })

  it('EXTENSION_DEV_TOKEN carries its own scope too', () => {
    process.env.EXTENSION_DEV_TOKEN = 'tok_env'
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    writeProject('pubwalk')
    const plan = buildPublishPlan({projectPath: projectDir})
    expect(plan.request.headers.authorization).toBe('Bearer tok_env')
    expect(plan.scope.source).toBe('env')
  })

  it('a stored login with no projectSlug cannot gate anything', () => {
    writeStoredLogin('tok_stored')
    writeProject('pubwalk')
    expect(() => buildPublishRequest({projectPath: projectDir})).not.toThrow()
  })

  it('falls back to the directory name when the project has no package.json', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    expect(() => buildPublishRequest({projectPath: projectDir})).toThrow(
      new RegExp(path.basename(projectDir))
    )
  })

  it('reads the extension manifest name when there is no package.json', () => {
    writeStoredLogin('tok_stored', {projectSlug: 'xvelte'})
    fs.mkdirSync(path.join(projectDir, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(projectDir, 'src', 'manifest.json'),
      JSON.stringify({name: 'xvelte', manifest_version: 3})
    )
    expect(() => buildPublishRequest({projectPath: projectDir})).not.toThrow()
  })
})
