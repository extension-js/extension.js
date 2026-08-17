import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Telemetry} from '../telemetry'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-flush-'))
const savedConfigHome = process.env.XDG_CONFIG_HOME
process.env.XDG_CONFIG_HOME = sandbox

afterAll(() => {
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedConfigHome
  fs.rmSync(sandbox, {recursive: true, force: true})
})

const COLD_ROUND_TRIP_MS = 700

type Attempt = {aborted: boolean; settled: 'ok' | 'aborted' | null}

function slowCapture(attempt: Attempt, latencyMs: number) {
  return (_url: unknown, init?: {signal?: AbortSignal}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        attempt.settled = 'ok'
        resolve(new Response('{"status":"Ok"}', {status: 200}))
      }, latencyMs)

      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        attempt.aborted = true
        attempt.settled = 'aborted'
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
}

function trackOne(telemetry: Telemetry) {
  telemetry.track('command_executed', {
    command: 'create',
    success: true,
    version: '9.9.9',
    template: 'content',
    source: 'templates'
  })
}

let attempt: Attempt

beforeEach(() => {
  attempt = {aborted: false, settled: null}
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the telemetry flush outlives a cold round trip', () => {
  it('does not abort a send that takes as long as a real one', async () => {
    vi.stubGlobal('fetch', vi.fn(slowCapture(attempt, COLD_ROUND_TRIP_MS)))

    const telemetry = new Telemetry({app: 'extension', version: '9.9.9'})
    trackOne(telemetry)
    await telemetry.flush()

    expect(attempt.aborted).toBe(false)
    expect(attempt.settled).toBe('ok')
  })

  it('still aborts when the caller asks for a ceiling below the round trip', async () => {
    vi.stubGlobal('fetch', vi.fn(slowCapture(attempt, COLD_ROUND_TRIP_MS)))

    const telemetry = new Telemetry({
      app: 'extension',
      version: '9.9.9',
      timeoutMs: 50
    })
    trackOne(telemetry)
    await telemetry.flush()

    expect(attempt.aborted).toBe(true)
    expect(attempt.settled).toBe('aborted')
  })
})
