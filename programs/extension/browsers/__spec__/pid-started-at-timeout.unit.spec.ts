import {beforeEach, describe, expect, it, vi} from 'vitest'

const calls = vi.hoisted(() => [] as Array<{bin: string; opts: any}>)
const reply = vi.hoisted(() => ({value: {status: 0, stdout: ''} as any}))

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process'
    )

  return {
    ...actual,
    spawnSync: (bin: string, _args: string[], opts: unknown) => {
      calls.push({bin, opts})

      return reply.value
    }
  }
})

import {
  PID_START_PROBE_TIMEOUT_MS,
  pidStartedAtMs
} from '../browsers-lib/resolve-live-pid'

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
})
