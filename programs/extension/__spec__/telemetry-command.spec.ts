import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../helpers/telemetry-cli', () => ({
  getTelemetryConsent: vi.fn(() => ({enabled: true, source: 'default'})),
  setTelemetryConsent: vi.fn(() => ({ok: true, path: '/tmp/consent.json'}))
}))

import {registerTelemetryCommand} from '../commands/telemetry'
import {
  getTelemetryConsent,
  setTelemetryConsent
} from '../helpers/telemetry-cli'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerTelemetryCommand), argv)
}

describe('extension telemetry', () => {
  it('enables telemetry and reports the consent path', async () => {
    expect(await run(['telemetry', 'enable'])).toBe(0)
    expect(setTelemetryConsent).toHaveBeenCalledWith('enabled')
    expect(String(logSpy.mock.calls[0][0])).toContain('enabled')
  })

  it('disables telemetry', async () => {
    expect(await run(['telemetry', 'disable'])).toBe(0)
    expect(setTelemetryConsent).toHaveBeenCalledWith('disabled')
    expect(String(logSpy.mock.calls[0][0])).toContain('disabled')
  })

  it('exits 1 when the consent file cannot be written', async () => {
    vi.mocked(setTelemetryConsent).mockReturnValue({ok: false} as any)
    expect(await run(['telemetry', 'enable'])).toBe(1)
    expect(await run(['telemetry', 'disable'])).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })

  it('defaults to status and prints the source', async () => {
    expect(await run(['telemetry'])).toBe(0)
    expect(getTelemetryConsent).toHaveBeenCalled()
    expect(String(logSpy.mock.calls[0][0])).toContain('source: default')
  })

  it('rejects an unknown action', async () => {
    expect(await run(['telemetry', 'bogus'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'Unknown telemetry action: bogus'
    )
  })
})
