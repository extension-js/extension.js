import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerPublishCommand} from '../commands/publish'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const fetchMock = vi.fn()
const ORIG_ENV = {...process.env}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  vi.stubGlobal('fetch', fetchMock)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env = {...ORIG_ENV}
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
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prints the share URL and exits 0 on success', async () => {
    respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
    expect(await run(['publish', '--token', 'tok'])).toBe(0)
    expect(logSpy).toHaveBeenCalledWith('https://ext.dev/s/abc')
  })

  it('prints the raw payload with --output json', async () => {
    respondWith(200, JSON.stringify({shareUrl: 'https://ext.dev/s/abc'}))
    expect(await run(['publish', '--token', 'tok', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      shareUrl: 'https://ext.dev/s/abc'
    })
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
