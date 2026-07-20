import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Regression guard for the silent RDP connect loop: ECONNREFUSED retries used
// to log nothing for the entire budget (150 × 1000ms by default), so a dead
// port looked like a generic ~150s stall, this masked the launched-port
// double-derivation bug for as long as it did. connectClient must now emit a
// periodic progress line naming the port, and the final give-up error must
// name the port it gave up on.

let connectAttempts = 0
let succeedOnAttempt = Infinity

vi.mock('../../../../run-firefox/rdp/remote-firefox/messaging-client', () => {
  class FakeMessagingClient {
    _handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
    async connect() {
      connectAttempts++
      if (connectAttempts < succeedOnAttempt) {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:9330')
        ;(err as NodeJS.ErrnoException).code = 'ECONNREFUSED'
        throw err
      }
    }
    async request() {
      return {}
    }
    disconnect() {}
    on(ev: string, fn: (...a: unknown[]) => void) {
      ;(this._handlers[ev] ||= []).push(fn)
      return this
    }
    emit(ev: string, ...a: unknown[]) {
      for (const f of this._handlers[ev] || []) f(...a)
    }
  }
  return {MessagingClient: FakeMessagingClient}
})

async function importRemoteFirefox(maxRetries: number) {
  vi.resetModules()
  process.env.EXTENSION_RDP_MAX_RETRIES = String(maxRetries)
  process.env.EXTENSION_RDP_RETRY_INTERVAL_MS = '1'
  const mod = await import('../../../../run-firefox/rdp/remote-firefox')
  return mod.RemoteFirefox
}

describe('RemoteFirefox connect retry observability', () => {
  const envBackup = {
    retries: process.env.EXTENSION_RDP_MAX_RETRIES,
    interval: process.env.EXTENSION_RDP_RETRY_INTERVAL_MS
  }

  beforeEach(() => {
    connectAttempts = 0
    succeedOnAttempt = Infinity
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (envBackup.retries === undefined) {
      delete process.env.EXTENSION_RDP_MAX_RETRIES
    } else {
      process.env.EXTENSION_RDP_MAX_RETRIES = envBackup.retries
    }
    if (envBackup.interval === undefined) {
      delete process.env.EXTENSION_RDP_RETRY_INTERVAL_MS
    } else {
      process.env.EXTENSION_RDP_RETRY_INTERVAL_MS = envBackup.interval
    }
  })

  it('logs periodic progress naming the port while ECONNREFUSED retries run', async () => {
    const RemoteFirefox = await importRemoteFirefox(25)
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    await expect(rf.connectClient(9330)).rejects.toThrow('ECONNREFUSED')

    // Every 10th attempt over a 25-attempt budget → attempts 10 and 20.
    const progressLines = (console.log as any).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((line: string) => line.includes('debugger server'))
    expect(progressLines).toHaveLength(2)
    expect(progressLines[0]).toContain('port 9330')
    expect(progressLines[0]).toContain('(attempt 10/25)')
    expect(progressLines[1]).toContain('(attempt 20/25)')
  })

  it('names the port in the final give-up error', async () => {
    const RemoteFirefox = await importRemoteFirefox(12)
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    await expect(rf.connectClient(9330)).rejects.toThrow('ECONNREFUSED')

    const errorLines = (console.error as any).mock.calls.map((c: unknown[]) =>
      String(c[0])
    )
    expect(errorLines.some((line: string) => line.includes('port 9330'))).toBe(
      true
    )
  })

  it('stays quiet when the connection succeeds before the first log threshold', async () => {
    const RemoteFirefox = await importRemoteFirefox(25)
    succeedOnAttempt = 3
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    await rf.connectClient(9230)

    const progressLines = (console.log as any).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((line: string) => line.includes('debugger server'))
    expect(progressLines).toHaveLength(0)
    expect(console.error).not.toHaveBeenCalled()
  })
})
