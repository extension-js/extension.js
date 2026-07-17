import {describe, it, expect, vi} from 'vitest'

// Mock the RDP messaging client so connectClient() runs without a real socket.
// A minimal on/emit lets us simulate the transport "reconnected" event.
vi.mock(
  '../../../../run-firefox/rdp/remote-firefox/messaging-client',
  () => {
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
        ;(this._handlers[ev] || []).forEach((f) => f(...a))
      }
    }
    return {MessagingClient: FakeMessagingClient}
  }
)

import {RemoteFirefox} from '../../../../run-firefox/rdp/remote-firefox'

describe('RemoteFirefox connection-scoped actor cache', () => {
  // Regression: a transient first-attempt failure used to poison
  // cachedAddonsActor with a previous connection's actor id
  // (server1.conn0.addonsActor2). Every retry then reused that dead id and
  // failed deterministically with "noSuchActor", so Firefox never recovered.
  it('clears the addonsActor cache when a new RDP connection is established', async () => {
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    rf.cachedAddonsActor = 'server1.conn0.addonsActor2'

    await rf.connectClient(9999)

    expect(rf.cachedAddonsActor).toBeUndefined()
  })

  it('re-clears the cache when the transport transparently reconnects', async () => {
    const rf: any = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = await rf.connectClient(9999)

    // Simulate discovering an actor on this connection, then a reconnect.
    rf.cachedAddonsActor = 'server1.conn1.addonsActor5'
    client.emit('reconnected')

    expect(rf.cachedAddonsActor).toBeUndefined()
  })
})
