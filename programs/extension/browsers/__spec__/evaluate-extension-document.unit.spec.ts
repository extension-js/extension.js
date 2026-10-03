import EventEmitter from 'node:events'
import net from 'node:net'
import {describe, expect, it} from 'vitest'
import {
  evaluateExtensionDocument,
  evaluateThroughWatcher,
  extensionDocumentPagePath,
  isExtensionDocumentContext,
  POLL_EXPRESSION,
  pickDocumentFrame,
  readSettledSlot,
  startExpression
} from '../run-firefox/rdp/evaluate-extension-document'
import {MessagingClient} from '../run-firefox/rdp/remote-firefox/messaging-client'

const ADDON_ID = 'repro@extension.js'
const UUID = 'moz-extension://6ce00885-f57b-408f-9c84-c69710a93bc1'

const BACKGROUND_FRAME = {
  url: `${UUID}/_generated_background_page.html`,
  consoleActor: 'console-background',
  isFallbackExtensionDocument: false
}

const NEWTAB_FRAME = {
  url: `${UUID}/chrome_url_overrides/newtab.html`,
  consoleActor: 'console-newtab',
  isFallbackExtensionDocument: false
}

const FALLBACK_FRAME = {
  url: `resource://devtools-webextension-fallback/webextension-fallback.html#${ADDON_ID}`,
  consoleActor: 'console-fallback',
  isFallbackExtensionDocument: true
}

interface FakeClientOptions {
  addons?: Array<{actor?: unknown; id?: unknown}>
  watcher?: {actor?: unknown}
  frames?: Array<Record<string, unknown>>
  evaluate?: (consoleActor: string, expression: string) => Promise<unknown>
}

class FakeRdpClient extends EventEmitter {
  requests: Array<Record<string, unknown>> = []
  evaluated: Array<{consoleActor: string; expression: string}> = []
  private options: FakeClientOptions

  constructor(options: FakeClientOptions = {}) {
    super()
    this.options = options
  }

  async request(payload: Record<string, unknown>): Promise<unknown> {
    this.requests.push(payload)

    if (payload.type === 'listAddons') {
      return {
        addons: this.options.addons ?? [{actor: 'addon-actor', id: ADDON_ID}]
      }
    }

    if (payload.type === 'getWatcher') {
      return this.options.watcher ?? {actor: 'watcher-actor'}
    }

    if (payload.type === 'watchTargets') {
      for (const target of this.options.frames ?? []) {
        this.emit('message', {type: 'target-available-form', target})
      }

      return {from: 'watcher-actor'}
    }

    return {}
  }

  async evaluate(consoleActor: string, expression: string): Promise<unknown> {
    this.evaluated.push({consoleActor, expression})

    if (this.options.evaluate) {
      return await this.options.evaluate(consoleActor, expression)
    }

    return expression === POLL_EXPRESSION
      ? JSON.stringify({state: 'value', json: '2'})
      : 'started'
  }
}

const run = (client: FakeRdpClient, overrides: Record<string, unknown> = {}) =>
  evaluateThroughWatcher({
    client: client as never,
    extensionId: ADDON_ID,
    context: 'background',
    expression: '1 + 1',
    timeoutMs: 500,
    ...overrides
  })

describe('the Gecko extension-document evaluator', () => {
  it('drives the same surface the real RDP client exposes', () => {
    const real = MessagingClient.prototype as unknown as Record<string, unknown>

    for (const member of ['request', 'evaluate', 'connect', 'disconnect']) {
      expect(
        typeof real[member],
        `MessagingClient lost ${member}, the fake is stale`
      ).toBe('function')
    }

    expect(new FakeRdpClient()).toBeInstanceOf(EventEmitter)
    expect(MessagingClient.prototype).toBeInstanceOf(EventEmitter)
  })

  it('names every extension-document context and no tab context', () => {
    for (const context of [
      'background',
      'popup',
      'options',
      'sidebar',
      'devtools',
      'newtab',
      'history',
      'bookmarks'
    ]) {
      expect(isExtensionDocumentContext(context), context).toBe(true)
    }

    expect(isExtensionDocumentContext('content')).toBe(false)
    expect(isExtensionDocumentContext('page')).toBe(false)
  })

  it('reads each surface page out of the emitted manifest', () => {
    const manifest = {
      action: {default_popup: 'action/index.html'},
      options_ui: {page: 'options/index.html'},
      sidebar_action: {default_panel: './sidebar/index.html'},
      devtools_page: 'devtools/index.html',
      chrome_url_overrides: {
        newtab: 'chrome_url_overrides/newtab.html',
        history: 'chrome_url_overrides/history.html'
      }
    }

    expect(extensionDocumentPagePath(manifest, 'popup')).toBe(
      'action/index.html'
    )

    expect(extensionDocumentPagePath(manifest, 'options')).toBe(
      'options/index.html'
    )

    expect(extensionDocumentPagePath(manifest, 'sidebar')).toBe(
      'sidebar/index.html'
    )

    expect(extensionDocumentPagePath(manifest, 'devtools')).toBe(
      'devtools/index.html'
    )

    expect(extensionDocumentPagePath(manifest, 'newtab')).toBe(
      'chrome_url_overrides/newtab.html'
    )

    expect(extensionDocumentPagePath(manifest, 'bookmarks')).toBeUndefined()
    expect(extensionDocumentPagePath(manifest, 'background')).toBeUndefined()
  })

  it('reads a vendor-prefixed key and the MV2 spellings', () => {
    expect(
      extensionDocumentPagePath(
        {'gecko:browser_action': {default_popup: 'popup.html'}},
        'popup'
      )
    ).toBe('popup.html')

    expect(
      extensionDocumentPagePath({options_page: '/options.html'}, 'options')
    ).toBe('options.html')
  })

  it('picks the background document and skips the devtools fallback', () => {
    expect(
      pickDocumentFrame([FALLBACK_FRAME, BACKGROUND_FRAME], 'background')
    ).toBe('console-background')

    expect(pickDocumentFrame([FALLBACK_FRAME], 'background')).toBeUndefined()

    expect(
      pickDocumentFrame(
        [{url: `${UUID}/background.html`, consoleActor: 'mv2'}],
        'background'
      )
    ).toBe('mv2')
  })

  it('matches a surface document by its page path, query and hash aside', () => {
    expect(
      pickDocumentFrame(
        [BACKGROUND_FRAME, NEWTAB_FRAME],
        'newtab',
        'chrome_url_overrides/newtab.html'
      )
    ).toBe('console-newtab')

    expect(
      pickDocumentFrame(
        [{url: `${UUID}/options/index.html?x=1#y`, consoleActor: 'opt'}],
        'options',
        'options/index.html'
      )
    ).toBe('opt')

    expect(
      pickDocumentFrame([NEWTAB_FRAME], 'options', 'options/index.html')
    ).toBeUndefined()

    expect(pickDocumentFrame([NEWTAB_FRAME], 'options')).toBeUndefined()
  })

  it('never takes a page path as a suffix of a longer name', () => {
    expect(
      pickDocumentFrame(
        [{url: `${UUID}/not-options/index.html`, consoleActor: 'other'}],
        'options',
        'options/index.html'
      )
    ).toBeUndefined()
  })

  it('reads a settled slot into a value, an undefined, or a throw', () => {
    expect(
      readSettledSlot(JSON.stringify({state: 'value', json: '2'}))
    ).toEqual({ok: true, value: 2})

    expect(
      readSettledSlot(JSON.stringify({state: 'value', json: '{"a":[1,2]}'}))
    ).toEqual({ok: true, value: {a: [1, 2]}})

    expect(readSettledSlot(JSON.stringify({state: 'value'}))).toEqual({
      ok: true,
      value: undefined
    })

    expect(
      readSettledSlot(
        JSON.stringify({state: 'throw', message: 'x is not defined'})
      )
    ).toEqual({
      ok: false,
      error: {
        name: 'EvalError',
        message: 'x is not defined',
        engine: 'firefox'
      }
    })

    expect(readSettledSlot(JSON.stringify({state: 'pending'}))).toBeUndefined()
    expect(readSettledSlot('null')).toBeUndefined()
    expect(readSettledSlot('not json')).toBeUndefined()
    expect(readSettledSlot(2)).toBeUndefined()
  })

  it('wraps the expression so a promise is awaited and the value is JSON', () => {
    const source = startExpression('browser.runtime.getPlatformInfo()')

    expect(source).toContain(
      'Promise.resolve((browser.runtime.getPlatformInfo()))'
    )

    expect(source).toContain('JSON.stringify(value)')
    expect(POLL_EXPRESSION).toContain('JSON.stringify(slot)')
    expect(POLL_EXPRESSION).toContain('delete globalThis.__extjsRdpEval')
  })

  it('evaluates in the background document through the watcher', async () => {
    const client = new FakeRdpClient({frames: [BACKGROUND_FRAME]})
    const outcome = await run(client)

    expect(outcome).toEqual({ok: true, value: 2})
    expect(client.evaluated[0].consoleActor).toBe('console-background')
    expect(client.evaluated[0].expression).toContain('Promise.resolve((1 + 1))')
    expect(client.requests.map((r) => r.type)).toEqual([
      'listAddons',
      'getWatcher',
      'watchTargets',
      'unwatchTargets'
    ])
  })

  it('evaluates in an open surface document by its page path', async () => {
    const client = new FakeRdpClient({
      frames: [BACKGROUND_FRAME, NEWTAB_FRAME],
      evaluate: async (_actor, expression) =>
        expression === POLL_EXPRESSION
          ? JSON.stringify({state: 'value', json: '"newtab-alive"'})
          : 'started'
    })

    const outcome = await run(client, {
      context: 'newtab',
      pagePath: 'chrome_url_overrides/newtab.html'
    })

    expect(outcome).toEqual({ok: true, value: 'newtab-alive'})
    expect(client.evaluated[0].consoleActor).toBe('console-newtab')
  })

  it('reports a throw inside the document as a guest error, not a refusal', async () => {
    const client = new FakeRdpClient({
      frames: [BACKGROUND_FRAME],
      evaluate: async (_actor, expression) =>
        expression === POLL_EXPRESSION
          ? JSON.stringify({state: 'throw', message: 'nope is not defined'})
          : 'started'
    })

    expect(await run(client)).toEqual({
      ok: false,
      error: {
        name: 'EvalError',
        message: 'nope is not defined',
        engine: 'firefox'
      }
    })
  })

  it('refuses when Firefox does not list the add-on', async () => {
    const client = new FakeRdpClient({addons: []})
    const outcome = await run(client)

    expect(outcome).toMatchObject({
      ok: false,
      error: {name: 'TargetNotFound'}
    })

    expect((outcome as {error: {message: string}}).error.message).toContain(
      ADDON_ID
    )
  })

  it('refuses when the build exposes no watcher actor', async () => {
    const client = new FakeRdpClient({watcher: {}})

    expect(await run(client)).toMatchObject({
      ok: false,
      error: {name: 'Unsupported'}
    })
  })

  it('refuses a document that is not open and names how to open it', async () => {
    const client = new FakeRdpClient({frames: [BACKGROUND_FRAME]})
    const outcome = await run(client, {
      context: 'options',
      pagePath: 'options/index.html'
    })

    expect(outcome).toMatchObject({ok: false, error: {name: 'TargetNotFound'}})
    expect((outcome as {error: {message: string}}).error.message).toContain(
      'extension open options'
    )
  })

  it('reports a slot that never settles as a timeout', async () => {
    const client = new FakeRdpClient({
      frames: [BACKGROUND_FRAME],
      evaluate: async (_actor, expression) =>
        expression === POLL_EXPRESSION
          ? JSON.stringify({state: 'pending'})
          : 'started'
    })

    const outcome = await run(client, {timeoutMs: 150})

    expect(outcome).toMatchObject({ok: false, error: {name: 'Timeout'}})
  })

  // The transport waits its own 30 s for a greeting. A command promised an
  // answer inside --timeout must not sit on a port that accepts and says
  // nothing, or on one that answers with something other than RDP.
  for (const [label, greet] of [
    ['never greets', (_socket: net.Socket) => {}],
    ['answers junk', (socket: net.Socket) => socket.write('not-rdp\n')]
  ] as const) {
    it(`reports a debugger port that ${label} as a timeout inside --timeout`, async () => {
      const sockets: net.Socket[] = []
      const server = net.createServer((socket) => {
        sockets.push(socket)
        greet(socket)
      })

      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )

      const port = (server.address() as net.AddressInfo).port

      try {
        const started = Date.now()
        const outcome = await evaluateExtensionDocument({
          rdpPort: port,
          extensionId: ADDON_ID,
          context: 'background',
          expression: '1 + 1',
          timeoutMs: 300
        })
        const elapsed = Date.now() - started

        expect(outcome).toMatchObject({
          ok: false,
          error: {
            name: 'Timeout',
            message: expect.stringContaining('within 300ms')
          }
        })

        expect(elapsed).toBeLessThan(5000)
      } finally {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })
  }
})
