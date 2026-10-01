import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerPublishCommand} from '../commands/publish'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const fetchMock = vi.fn()
const ORIG_ENV = {...process.env}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let configDir = ''

beforeEach(() => {
  stubProcessExit()
  vi.stubGlobal('fetch', fetchMock)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  // Keep the developer's real stored login out of the no-token tests.
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-cmd-'))
  process.env.XDG_CONFIG_HOME = configDir
  process.env.APPDATA = configDir
  delete process.env.EXTENSION_DEV_DOCS_URL
  process.env.EXTENSION_DEV_API_URL = 'https://platform.test'
})

afterEach(() => {
  process.env = {...ORIG_ENV}
  fs.rmSync(configDir, {recursive: true, force: true})
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerPublishCommand), argv)
}

function respondWith(status: number, body: string) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as Response)
}

describe('extension publish', () => {
  it('exits 1 with the token hint and no docs link when no token is available', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(await run(['publish'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('EXTENSION_DEV_TOKEN')
    expect(String(errorSpy.mock.calls[0][0])).not.toContain('Get a token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the docs token page in the refusal when a docs host is configured', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    process.env.EXTENSION_DEV_DOCS_URL = 'https://docs.platform.test'
    expect(await run(['publish'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'https://docs.platform.test/tools/publish'
    )
  })

  it('names the platform login in the no-token refusal', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(await run(['publish'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('platform MCP')
  })

  it('refuses before any request when no platform URL is configured', async () => {
    delete process.env.EXTENSION_DEV_API_URL
    expect(await run(['publish', '--token', 'tok'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('EXTENSION_DEV_API_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('publishes with the stored device login when no flag or env is set', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    const dir = path.join(configDir, 'extension-dev')
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({version: 1, token: 'tok_stored'})
    )

    respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
    expect(await run(['publish'])).toBe(0)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://platform.test/api/cli/publish'
    )

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok_stored'
    )
  })

  it('prints the share URL and exits 0 on success', async () => {
    respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
    expect(await run(['publish', '--token', 'tok'])).toBe(0)
    expect(logSpy).toHaveBeenCalledWith('https://ext.dev/s/abc')
  })

  it('emits a schema-1 envelope carrying the payload with --output json', async () => {
    respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      schema: 1,
      ok: true,
      command: 'publish',
      status: 'published',
      value: {
        shareUrl: 'https://ext.dev/s/abc',
        project: path.basename(process.cwd()) && expect.any(String),
        tokenSource: 'flag'
      },
      error: null,
      warnings: []
    })
  })

  it('names the project the share is for, so no reader has to parse the URL', async () => {
    respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(0)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(String(frame.value.project).length).toBeGreaterThan(0)
    expect(frame.value.tokenSource).toBe('flag')
  })

  it('emits E_AUTH_REQUIRED on stdout when no token is available', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(await run(['publish', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'publish',
      status: 'denied',
      value: null
    })

    expect(frame.error.code).toBe('E_AUTH_REQUIRED')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('emits E_PUBLISH_REJECTED on a non-2xx response', async () => {
    respondWith(403, JSON.stringify({message: 'token expired'}))
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('rejected')
    expect(frame.error.code).toBe('E_PUBLISH_REJECTED')
    expect(frame.error.message).toContain('token expired')
  })

  it('emits E_NETWORK when the transport fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('failed')
    expect(frame.error.code).toBe('E_NETWORK')
    expect(frame.error.message).toContain('ECONNREFUSED')
  })

  it('prints nothing but the share URL on stdout', async () => {
    respondWith(
      200,
      JSON.stringify({shareUrl: ' https://ext.dev/s/abc ', buildSha: 'abc'})
    )

    expect(await run(['publish', '--token', 'tok'])).toBe(0)
    expect(logSpy.mock.calls).toEqual([['https://ext.dev/s/abc']])
  })

  it('refuses a 2xx without a shareUrl and keeps stdout empty', async () => {
    respondWith(
      200,
      JSON.stringify({ok: true, message: 'build queued, no link yet'})
    )

    expect(await run(['publish', '--token', 'tok'])).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0][0])).toContain('no share URL')
    expect(String(errorSpy.mock.calls[0][0])).toContain('build queued')
  })

  it('maps a 2xx without a shareUrl to E_PUBLISH_REJECTED under --output json', async () => {
    respondWith(200, JSON.stringify({ok: true, message: 'build queued'}))
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(1)
    expect(logSpy).toHaveBeenCalledTimes(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('rejected')
    expect(frame.value).toBeNull()
    expect(frame.error.code).toBe('E_PUBLISH_REJECTED')
    expect(frame.hint).toContain('--api')
  })

  it('does not report a partial publish as published', async () => {
    respondWith(
      200,
      JSON.stringify({shareUrl: null, status: 'partial', failed: ['chrome']})
    )

    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('partial')
    expect(frame.error.code).toBe('E_PUBLISH_REJECTED')
    expect(frame.error.message).toContain('chrome')
  })

  it('refuses a partial publish even when a link came back', async () => {
    respondWith(
      200,
      JSON.stringify({
        shareUrl: 'https://ext.dev/s/abc',
        status: 'partial',
        failed: ['firefox']
      })
    )

    expect(await run(['publish', '--token', 'tok'])).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0][0])).toContain('firefox')
  })

  it('refuses a 200 HTML page instead of calling it published', async () => {
    respondWith(200, '<html>bad gateway</html>')
    expect(await run(['publish', '--token', 'tok'])).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0][0])).toContain('no share URL')
    expect(String(errorSpy.mock.calls[0][0])).toContain('bad gateway')
  })

  it('refuses a 2xx whose JSON is not an object', async () => {
    respondWith(200, '"https://ext.dev/s/abc"')
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.error.code).toBe('E_PUBLISH_REJECTED')
  })

  it('keeps E_AUTH_REQUIRED for the no-token case with a hint that skips --api', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(await run(['publish', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('denied')
    expect(frame.error.code).toBe('E_AUTH_REQUIRED')
    expect(frame.error.refs).toBeUndefined()
    expect(frame.hint).toContain('--token')
    expect(frame.hint).not.toContain('--api')
  })

  it('reports a missing platform URL as E_ARGS usage, not an auth problem', async () => {
    delete process.env.EXTENSION_DEV_API_URL
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('usage')
    expect(frame.error.code).toBe('E_ARGS')
    expect(frame.error.message).toContain('EXTENSION_DEV_API_URL')
    expect(frame.hint).toContain('--api')
    expect(frame.hint).not.toContain('--token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('with a stored login scoped to another project', () => {
    let projectDir = ''

    beforeEach(() => {
      delete process.env.EXTENSION_DEV_TOKEN
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-scope-'))
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({name: 'pubwalk', version: '1.0.0'})
      )

      const dir = path.join(configDir, 'extension-dev')
      fs.mkdirSync(dir, {recursive: true})
      fs.writeFileSync(
        path.join(dir, 'auth.json'),
        JSON.stringify({version: 1, token: 'tok_stored', projectSlug: 'xvelte'})
      )
    })

    afterEach(() => {
      fs.rmSync(projectDir, {recursive: true, force: true})
    })

    it('reports a --project mismatch as E_INVALID_OPTION naming the flag', async () => {
      expect(
        await run([
          'publish',
          projectDir,
          '--project',
          'other',
          '--api',
          'https://platform.test',
          '--output',
          'json'
        ])
      ).toBe(1)

      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame.status).toBe('usage')
      expect(frame.error.code).toBe('E_INVALID_OPTION')
      expect(frame.error.refs).toEqual({flag: '--project'})
      expect(frame.error.message).toContain('xvelte')
      expect(frame.hint).toContain('--project xvelte')
      expect(frame.hint).not.toContain('--api')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports a directory mismatch as E_INVALID_OPTION naming the path', async () => {
      expect(
        await run([
          'publish',
          projectDir,
          '--api',
          'https://platform.test',
          '--output',
          'json'
        ])
      ).toBe(1)

      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame.status).toBe('usage')
      expect(frame.error.code).toBe('E_INVALID_OPTION')
      expect(frame.error.refs).toEqual({path: path.resolve(projectDir)})
      expect(frame.error.message).toContain('pubwalk')
      expect(frame.hint).toContain('--project xvelte')
      expect(frame.hint).not.toContain('--api')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('an expired stored login never reaches the wire', () => {
    function writeStoredLogin(expiresAt: unknown) {
      delete process.env.EXTENSION_DEV_TOKEN
      const dir = path.join(configDir, 'extension-dev')
      fs.mkdirSync(dir, {recursive: true})
      fs.writeFileSync(
        path.join(dir, 'auth.json'),
        JSON.stringify({version: 1, token: 'tok_expired', expiresAt})
      )
    }

    it.each([
      ['an ISO string', '2020-01-01T00:00:00Z'],
      ['a millisecond epoch', 1577836800000],
      ['a negative number', -1577836800],
      ['a non-numeric string', 'never']
    ])('refuses before any request when expiresAt is %s', async (_, at) => {
      writeStoredLogin(at)
      respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
      expect(await run(['publish', '--output', 'json'])).toBe(1)
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame.error.code).toBe('E_AUTH_REQUIRED')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('exits 1 with the status and message on an API error', async () => {
    respondWith(403, JSON.stringify({message: 'token expired'}))
    expect(await run(['publish', '--token', 'tok'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('403')
    expect(String(errorSpy.mock.calls[0][0])).toContain('token expired')
  })

  it('exits 1 when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await run(['publish', '--token', 'tok'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('Could not reach')
  })
})
