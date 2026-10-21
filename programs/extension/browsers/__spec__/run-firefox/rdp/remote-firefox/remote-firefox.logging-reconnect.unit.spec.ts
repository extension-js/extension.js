import {beforeEach, describe, expect, it, vi} from 'vitest'

const attachConsoleListeners = vi.fn(async () => {})
const subscribeUnifiedLogging = vi.fn()

vi.mock('../../../../run-firefox/rdp/remote-firefox/logging', () => ({
  attachConsoleListeners: (...a: unknown[]) => attachConsoleListeners(...a),
  subscribeUnifiedLogging: (...a: unknown[]) => subscribeUnifiedLogging(...a)
}))

vi.mock('../../../../run-firefox/rdp/remote-firefox/messaging-client', () => {
  class FakeMessagingClient {
    _handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
    async connect() {}
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

import {RemoteFirefox} from '../../../../run-firefox/rdp/remote-firefox'

describe('RemoteFirefox unified logging across a reconnect', () => {
  beforeEach(() => {
    attachConsoleListeners.mockClear()
    subscribeUnifiedLogging.mockClear()
  })

  it('starts the console listeners again on the new connection', async () => {
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox',
      resolvedRdpPort: 9999
    } as any)

    const client = await rf.connectClient(9999)
    await rf.enableUnifiedLogging({level: 'info'})

    expect(attachConsoleListeners).toHaveBeenCalledTimes(1)

    client.emit('reconnected')
    await Promise.resolve()

    expect(attachConsoleListeners).toHaveBeenCalledTimes(2)
    expect(subscribeUnifiedLogging).toHaveBeenCalledTimes(1)
  })

  it('leaves listeners alone on a reconnect when logging was never enabled', async () => {
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = await rf.connectClient(9999)
    client.emit('reconnected')
    await Promise.resolve()

    expect(attachConsoleListeners).not.toHaveBeenCalled()
  })
})
