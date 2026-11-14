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

// The live session's client, as far as an evaluation in the background
// document drives it.
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

describe('evaluating in the background of an installed add-on', () => {
  it('evaluates in the background document over the session it holds', async () => {
    const client = new FakeSessionClient([BACKGROUND_FRAME])
    const remote = makeRemote(client, ADDON_ID)

    await expect(remote.evaluateInBackground('probe()', 1000)).resolves.toEqual(
      {outcome: 'settled'}
    )

    expect(client.evaluated[0].consoleActor).toBe('console-background')
    expect(client.evaluated[0].expression).toContain('probe()')
    expect(client.requests.map((request) => request.type)).toEqual([
      'listAddons',
      'getWatcher',
      'watchTargets',
      'unwatchTargets'
    ])
  })

  it('answers undefined when the add-on has no background document', async () => {
    const client = new FakeSessionClient([])
    const remote = makeRemote(client, ADDON_ID)

    await expect(
      remote.evaluateInBackground('probe()', 150)
    ).resolves.toBeUndefined()

    expect(client.evaluated).toEqual([])
  })

  it('answers undefined with no session or no add-on id, and asks nothing', async () => {
    const client = new FakeSessionClient([BACKGROUND_FRAME])

    await expect(
      makeRemote(null, ADDON_ID).evaluateInBackground('probe()', 1000)
    ).resolves.toBeUndefined()

    await expect(
      makeRemote(client, undefined).evaluateInBackground('probe()', 1000)
    ).resolves.toBeUndefined()

    expect(client.requests).toEqual([])
  })
})
