import type {SpawnSyncOptions} from 'node:child_process'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const calls = vi.hoisted(
  () => [] as Array<{bin: string; opts: SpawnSyncOptions}>
)
const reply = vi.hoisted(() => ({
  value: {status: 0, stdout: ''} as {
    status: number | null
    stdout: string
    error?: Error
  }
}))

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process'
    )

  return {
    ...actual,
    spawnSync: (bin: string, _args: string[], opts: SpawnSyncOptions) => {
      calls.push({bin, opts})

      return reply.value
    }
  }
})

import {
  EXIT_PROBE_TIMEOUT_MS,
  teardownDefaults
} from '../../browsers-lib/process-teardown'
import {
  PID_START_PROBE_TIMEOUT_MS,
  pidStartedAtIso,
  pidStartedAtMs
} from '../../browsers-lib/resolve-live-pid'

beforeEach(() => {
  calls.length = 0
  reply.value = {status: 0, stdout: ''}
})

describe('pidStartedAtMs', () => {
  it('bounds the Windows PowerShell query and the ps query', () => {
    pidStartedAtMs(1234, 'win32')
    pidStartedAtMs(1234, 'darwin')

    expect(calls.map((c) => c.bin)).toEqual(['powershell.exe', 'ps'])

    for (const call of calls) {
      expect(call.opts.timeout).toBe(PID_START_PROBE_TIMEOUT_MS)
    }
  })

  it.each([
    'win32',
    'darwin',
    'linux'
  ] as const)('gives the %s query the bound its caller names', (platform) => {
    pidStartedAtMs(1234, platform, 750)

    expect(calls).toHaveLength(1)
    expect(calls[0].opts.timeout).toBe(750)
  })

  // An exit handler holds the process until it returns.
  it('gives the query of an exiting process the short bound, the other the long one', () => {
    teardownDefaults.startedAtOnExit(1234)
    teardownDefaults.startedAt(1234)

    expect(calls.map((call) => call.opts.timeout)).toEqual([
      EXIT_PROBE_TIMEOUT_MS,
      PID_START_PROBE_TIMEOUT_MS
    ])

    expect(EXIT_PROBE_TIMEOUT_MS).toBeLessThan(PID_START_PROBE_TIMEOUT_MS)
  })

  it('reads a probe that timed out as unknown', () => {
    reply.value = {
      status: null,
      stdout: '',
      error: Object.assign(new Error('spawnSync powershell.exe ETIMEDOUT'), {
        code: 'ETIMEDOUT'
      })
    }

    expect(pidStartedAtMs(1234, 'win32')).toBeNull()
  })

  it('parses the start time a probe answers with', () => {
    reply.value = {status: 0, stdout: '2026-10-09T23:37:03.0000000Z\n'}

    expect(pidStartedAtMs(1234, 'win32')).toBe(
      Date.parse('2026-10-09T23:37:03.000Z')
    )
  })

  it('asks ps in the C locale, the one spelling Date.parse reads', () => {
    pidStartedAtMs(1234, 'darwin')

    expect(calls[0].opts.env?.LC_ALL).toBe('C')
  })
})

describe('pidStartedAtIso', () => {
  it('answers the start as an ISO UTC string, and nothing for a pid it cannot date', () => {
    reply.value = {status: 0, stdout: 'Thu Nov 12 13:36:58 2026    \n'}

    expect(pidStartedAtIso(1234, 'darwin')).toBe(
      new Date(Date.parse('Thu Nov 12 13:36:58 2026')).toISOString()
    )

    reply.value = {status: 1, stdout: ''}

    expect(pidStartedAtIso(1234, 'darwin')).toBeUndefined()
  })
})
