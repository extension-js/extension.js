import EventEmitter from 'node:events'
import {describe, expect, it} from 'vitest'
import {POLL_EXPRESSION} from '../../../../run-firefox/rdp/evaluate-extension-document'
import {RemoteFirefox} from '../../../../run-firefox/rdp/remote-firefox'

const ADDON_ID = 'start-hold@example.test'
const BACKGROUND_FRAME = {
  url: 'moz-extension://6ce00885-f57b-408f-9c84-c69710a93bc1/_generated_background_page.html',
  consoleActor: 'console-background',
  isFallbackExtensionDocument: false
}

// The live session's client, as far as a read in the background document
// drives it.
class FakeSessionClient extends EventEmitter {
  requests: Array<Record<string, unknown>> = []
  evaluated: Array<{consoleActor: string; expression: string}> = []

  constructor(private readonly frames: Array<Record<string, unknown>>) {
    super()
  }

  async request(payload: Record<string, unknown>): Promise<unknown> {
    this.requests.push(payload)

    if (payload.type === 'listAddons') {
      return {addons: [{actor: 'addon-actor', id: ADDON_ID}]}
    }

    if (payload.type === 'getWatcher') return {actor: 'watcher-actor'}

    if (payload.type === 'watchTargets') {
      for (const target of this.frames) {
        this.emit('message', {type: 'target-available-form', target})
      }
    }

    return {}
  }

  async evaluate(consoleActor: string, expression: string): Promise<unknown> {
    this.evaluated.push({consoleActor, expression})

    return expression === POLL_EXPRESSION
      ? JSON.stringify({state: 'value', json: '{"outcome":"settled"}'})
      : 'started'
  }

  disconnect() {}
}

function makeRemote(client: FakeSessionClient | null, extensionId?: string) {
  const remote = new RemoteFirefox({browser: 'firefox'} as never) as any

  remote.client = client
  remote.derivedExtensionId = extensionId

  return remote as RemoteFirefox
}

const types = (client: FakeSessionClient) =>
  client.requests.map((request) => request.type)

describe('a session on the background of an installed add-on', () => {
  it('finds the background document once and reads in it many times', async () => {
    const client = new FakeSessionClient([BACKGROUND_FRAME])
    const session = await makeRemote(client, ADDON_ID).openBackgroundSession()

    await expect(session?.evaluate('probe()', 1000)).resolves.toEqual({
      outcome: 'settled'
    })

    await expect(session?.evaluate('again()', 1000)).resolves.toEqual({
      outcome: 'settled'
    })

    expect(client.evaluated[0].consoleActor).toBe('console-background')
    expect(client.evaluated[0].expression).toContain('probe()')
    expect(client.evaluated[2].expression).toContain('again()')
    expect(types(client)).toEqual(['listAddons', 'getWatcher', 'watchTargets'])
  })

  it('stops watching once on release', async () => {
    const client = new FakeSessionClient([BACKGROUND_FRAME])
    const session = await makeRemote(client, ADDON_ID).openBackgroundSession()

    session?.release()
    session?.release()
    await Promise.resolve()

    expect(types(client)).toEqual([
      'listAddons',
      'getWatcher',
      'watchTargets',
      'unwatchTargets'
    ])

    expect(client.listenerCount('message')).toBe(0)
  })

  it('reads nothing on a connection the launcher has replaced', async () => {
    const client = new FakeSessionClient([BACKGROUND_FRAME])
    const remote = makeRemote(client, ADDON_ID)
    const session = await remote.openBackgroundSession()

    ;(remote as any).client = new FakeSessionClient([BACKGROUND_FRAME])

    await expect(session?.evaluate('probe()', 1000)).resolves.toBeUndefined()

    expect(client.evaluated).toEqual([])
  })

  it('opens nothing, and stops watching, when there is no background document', async () => {
    const client = new FakeSessionClient([])

    await expect(
      makeRemote(client, ADDON_ID).openBackgroundSession()
    ).resolves.toBeUndefined()

    await Promise.resolve()

    expect(client.evaluated).toEqual([])
    expect(types(client).at(-1)).toBe('unwatchTargets')
  }, 10_000)

  it('opens nothing with no connection or no add-on id, and asks nothing', async () => {
    const client = new FakeSessionClient([BACKGROUND_FRAME])

    await expect(
      makeRemote(null, ADDON_ID).openBackgroundSession()
    ).resolves.toBeUndefined()

    await expect(
      makeRemote(client, undefined).openBackgroundSession()
    ).resolves.toBeUndefined()

    expect(client.requests).toEqual([])
  })
})
