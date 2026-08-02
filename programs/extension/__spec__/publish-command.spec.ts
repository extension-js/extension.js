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
  it('exits 1 with the token hint when no token is available', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(await run(['publish'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('EXTENSION_DEV_TOKEN')
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'https://docs.extension.dev/tools/publish'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the login command in the no-token refusal', async () => {
    delete process.env.EXTENSION_DEV_TOKEN
    expect(await run(['publish'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'npx @extension.dev/mcp login'
    )
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
      value: {shareUrl: 'https://ext.dev/s/abc'},
      error: null,
      warnings: []
    })
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

  it('falls back to printing the whole response without a shareUrl', async () => {
    respondWith(200, 'plain text receipt')
    expect(await run(['publish', '--token', 'tok'])).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toContain('plain text receipt')
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
