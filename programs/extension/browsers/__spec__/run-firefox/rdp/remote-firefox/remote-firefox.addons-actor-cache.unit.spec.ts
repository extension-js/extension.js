import type EventEmitter from 'node:events'
import {describe, expect, it, vi} from 'vitest'

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

type RemoteOptions = ConstructorParameters<typeof RemoteFirefox>[0]

// The private members these rows drive, reached through one cast.
interface RemoteInternals {
  connectClient(port: number): Promise<EventEmitter>
  enableUnifiedLogging(opts: {level: string}): Promise<void>
  cachedAddonsActor: string | undefined
}

function makeRemote(options: Partial<RemoteOptions>): RemoteInternals {
  return new RemoteFirefox(
    options as RemoteOptions
  ) as unknown as RemoteInternals
}

describe('RemoteFirefox connection-scoped actor cache', () => {
  it('clears the addonsActor cache when a new RDP connection is established', async () => {
    const rf = makeRemote({
      extension: 'dist/firefox',
      browser: 'firefox'
    })

    rf.cachedAddonsActor = 'server1.conn0.addonsActor2'

    await rf.connectClient(9999)

    expect(rf.cachedAddonsActor).toBeUndefined()
  })

  it('re-clears the cache when the transport transparently reconnects', async () => {
    const rf = makeRemote({
      extension: 'dist/firefox',
      browser: 'firefox'
    })

    const client = await rf.connectClient(9999)

    rf.cachedAddonsActor = 'server1.conn1.addonsActor5'
    client.emit('reconnected')

    expect(rf.cachedAddonsActor).toBeUndefined()
  })
})
