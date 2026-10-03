import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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

  it('logs periodic debug progress naming the port while ECONNREFUSED retries run', async () => {
    const previousDebug = process.env.EXTENSION_DEBUG
    process.env.EXTENSION_DEBUG = '1'

    try {
      const RemoteFirefox = await importRemoteFirefox(25)
      const rf: any = new RemoteFirefox({
        extension: 'dist/firefox',
        browser: 'firefox'
      } as any)

      await expect(rf.connectClient(9330)).rejects.toThrow(
        "Can't connect to Firefox on port 9330"
      )

      const progressLines = (console.log as any).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((line: string) => line.includes('debugger=wait'))
      expect(progressLines).toHaveLength(2)
      expect(progressLines[0]).toContain('port=9330')
      expect(progressLines[0]).toContain('attempt=10/25')
      expect(progressLines[1]).toContain('attempt=20/25')
    } finally {
      if (previousDebug === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else process.env.EXTENSION_DEBUG = previousDebug
    }
  })

  it('keeps the retry counter off the default verbosity tier', async () => {
    // isDebug() falls back to the legacy EXTENSION_AUTHOR_MODE alias, which
    // nightly CI exports; scrub both so this test really runs the default tier.
    const previousDebug = process.env.EXTENSION_DEBUG
    const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
    Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
    Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')

    try {
      const RemoteFirefox = await importRemoteFirefox(25)
      const rf: any = new RemoteFirefox({
        extension: 'dist/firefox',
        browser: 'firefox'
      } as any)

      await expect(rf.connectClient(9330)).rejects.toThrow(
        "Can't connect to Firefox on port 9330"
      )

      const progressLines = (console.log as any).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((line: string) => line.includes('debugger=wait'))
      expect(progressLines).toHaveLength(0)
    } finally {
      if (previousDebug === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else process.env.EXTENSION_DEBUG = previousDebug

      if (previousAuthorMode === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
      } else {
        process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
      }
    }
  })

  it('names the port in the final give-up error', async () => {
    const RemoteFirefox = await importRemoteFirefox(12)
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const error = await rf.connectClient(9330).then(
      () => undefined,
      (reason: Error & {code?: string; cause?: Error}) => reason
    )

    expect(error?.code).toBe('E_BROWSER_CONNECT')
    expect(error?.message).toContain('port 9330')
    expect(String(error?.cause?.message)).toContain('ECONNREFUSED')
    // The block travels on the error. Printed here too, it showed once per
    // outer retry and again where the error was caught.
    expect(console.error).not.toHaveBeenCalled()
  })

  it('stops dialing once the launcher says the browser is gone', async () => {
    const RemoteFirefox = await importRemoteFirefox(25)
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox',
      isBrowserGone: () => connectAttempts >= 2
    } as any)

    const error = await rf.connectClient(9330).then(
      () => undefined,
      (reason: Error & {code?: string}) => reason
    )

    expect(error?.code).toBe('E_BROWSER_LAUNCH')
    expect(error?.message).toContain(
      'Firefox exited before its debugger answered'
    )

    expect(connectAttempts).toBe(2)
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
