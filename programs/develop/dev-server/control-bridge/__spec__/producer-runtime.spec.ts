import {describe, it, expect} from 'vitest'
import {
  buildBridgeProducerSource,
  buildBridgeRelaySource,
  BRIDGE_PRODUCER_SOURCE
} from '../producer-runtime'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: {data: string}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.onclose && this.onclose()
  }
  triggerOpen() {
    this.onopen && this.onopen()
  }
  triggerMessage(obj: unknown) {
    this.onmessage && this.onmessage({data: JSON.stringify(obj)})
  }
}

function makeGlobal() {
  const calls: Array<{level: string; args: unknown[]}> = []
  const console: Record<string, (...a: unknown[]) => void> = {}
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    console[level] = (...args: unknown[]) => calls.push({level, args})
  }
  return {
    fakeGlobal: {WebSocket: FakeWebSocket, console} as Record<string, unknown>,
    originalCalls: calls
  }
}

function run(src: string, fakeGlobal: Record<string, unknown>) {
  // The IIFE reads `globalThis` first; pass our fake as that parameter.
  // eslint-disable-next-line no-new-func
  new Function('globalThis', src)(fakeGlobal)
}

describe('bridge producer runtime', () => {
  it('returns empty source when the control bridge is unavailable', () => {
    expect(buildBridgeProducerSource({controlPort: null, instanceId: 'x'})).toBe('')
    expect(buildBridgeProducerSource({controlPort: 0, instanceId: 'x'})).toBe('')
  })

  it('bakes port, instanceId, and context with no placeholders left', () => {
    const src = buildBridgeProducerSource({
      controlPort: 8147,
      instanceId: 'inst-T',
      context: 'background'
    })
    expect(src).toContain('8147')
    expect(src).toContain('inst-T')
    expect(src).not.toContain('__EXTJS_CONTROL_PORT__')
    expect(src).not.toContain('__EXTJS_INSTANCE_ID__')
    expect(src).not.toContain('__EXTJS_CONTEXT__')
  })

  it('sends a producer hello on open and forwards console as log frames', () => {
    FakeWebSocket.instances = []
    const {fakeGlobal, originalCalls} = makeGlobal()
    const src = buildBridgeProducerSource({
      controlPort: 9999,
      instanceId: 'inst-T',
      context: 'background'
    })
    run(src, fakeGlobal)

    // A console call before the socket opens is queued.
    ;(fakeGlobal.console as any).error('boom', {a: 1})

    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toBe('ws://127.0.0.1:9999/extjs-control')
    ws.triggerOpen()

    const frames = ws.sent.map((s) => JSON.parse(s))
    expect(frames[0]).toMatchObject({type: 'hello', v: 1, role: 'producer', instanceId: 'inst-T'})
    const log = frames.find((f) => f.type === 'log')
    expect(log.event).toMatchObject({
      v: 1,
      level: 'error',
      context: 'background',
      runId: 'inst-T'
    })
    expect(log.event.messageParts).toEqual(['boom', '{"a":1}'])
    expect(typeof log.event.id).toBe('string')

    // Original console must still fire (passthrough).
    expect(originalCalls).toContainEqual({level: 'error', args: ['boom', {a: 1}]})
  })

  it('installs only once per global', () => {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    const src = buildBridgeProducerSource({controlPort: 9999, instanceId: 'i'})
    run(src, fakeGlobal)
    run(src, fakeGlobal)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('does nothing when WebSocket is unavailable', () => {
    FakeWebSocket.instances = []
    const fakeGlobal: Record<string, unknown> = {console: {log() {}}}
    const src = buildBridgeProducerSource({controlPort: 9999, instanceId: 'i'})
    expect(() => run(src, fakeGlobal)).not.toThrow()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('source has no unresolved placeholders by construction', () => {
    expect(BRIDGE_PRODUCER_SOURCE).toContain('__EXTJS_CONTROL_PORT__')
  })
})

describe('bridge producer runtime — executor (Slice 2)', () => {
  function setup(chromeApi: Record<string, unknown>) {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    fakeGlobal.chrome = chromeApi
    fakeGlobal.navigator = {userAgent: 'Chrome'}
    fakeGlobal.setTimeout = (fn: () => void) => {
      fn()
      return 0
    }
    const src = buildBridgeProducerSource({
      controlPort: 9999,
      instanceId: 'inst-E',
      context: 'background'
    })
    run(src, fakeGlobal)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.sent = [] // drop the hello
    return ws
  }

  const results = (ws: FakeWebSocket) =>
    ws.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'result')

  it('storage.set then storage.get round-trips via chrome.storage', async () => {
    const store: Record<string, unknown> = {}
    const area = {
      get: (key: string | null) =>
        Promise.resolve(key == null ? {...store} : {[key]: store[key]}),
      set: (items: Record<string, unknown>) => {
        Object.assign(store, items)
        return Promise.resolve()
      }
    }
    const ws = setup({storage: {local: area}})

    ws.triggerMessage({
      type: 'command',
      cmdId: 's1',
      op: 'storage.set',
      target: {context: 'background'},
      args: {area: 'local', items: {hello: 'world'}}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(store.hello).toBe('world')

    ws.triggerMessage({
      type: 'command',
      cmdId: 's2',
      op: 'storage.get',
      target: {context: 'background'},
      args: {area: 'local', key: 'hello'}
    })
    await Promise.resolve()
    await Promise.resolve()
    const r = results(ws).find((f) => f.cmdId === 's2')
    expect(r).toMatchObject({ok: true, value: {hello: 'world'}})
  })

  it('eval evaluates an expression in the background context', async () => {
    const ws = setup({})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e1',
      op: 'eval',
      target: {context: 'background'},
      args: {expression: '1 + 2'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 'e1')).toMatchObject({ok: true, value: 3})
  })

  it('reload acks immediately then calls chrome.runtime.reload', async () => {
    let reloaded = false
    const ws = setup({runtime: {reload: () => (reloaded = true)}})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'r1',
      op: 'reload',
      target: {context: 'background'}
    })
    // The ack is sent before the (deferred) reload so the result isn't lost.
    expect(results(ws).find((f) => f.cmdId === 'r1')).toMatchObject({
      ok: true,
      value: {reloading: true}
    })
    expect(reloaded).toBe(false)
    await new Promise((r) => setTimeout(r, 80))
    expect(reloaded).toBe(true)
  })

  it('the relay answers a surface inspect request for its own context', () => {
    const listeners: Array<(m: any, s: any, r: any) => void> = []
    const fakeDoc = {
      title: 'Popup',
      documentElement: {outerHTML: '<html><body><p>popup</p></body></html>'},
      body: {children: {length: 1}},
      querySelectorAll: () => [] as any[]
    }
    const fakeGlobal: Record<string, unknown> = {
      console: {log: () => {}},
      document: fakeDoc,
      location: {href: 'chrome-extension://abc/popup.html'},
      chrome: {
        runtime: {
          sendMessage: () => {},
          lastError: undefined,
          onMessage: {addListener: (fn: any) => listeners.push(fn)}
        }
      }
    }
    run(buildBridgeRelaySource({context: 'popup'}), fakeGlobal)
    expect(listeners.length).toBe(1)

    // Non-matching context → no response.
    let responded: any = 'NONE'
    listeners[0]({__extjsInspectRequest: true, target: {context: 'options'}}, {}, (r: any) => (responded = r))
    expect(responded).toBe('NONE')

    // Matching context → DOM snapshot.
    listeners[0]({__extjsInspectRequest: true, target: {context: 'popup'}, args: {include: ['summary']}}, {}, (r: any) => (responded = r))
    expect(responded).toMatchObject({ok: true, value: {context: 'popup', title: 'Popup'}})
    expect(responded.value.summary.bodyChildCount).toBe(1)
  })

  it('the relay (content) forwards console via chrome.runtime.sendMessage', () => {
    const sent: any[] = []
    const fakeGlobal: Record<string, unknown> = {
      console: {warn: () => {}},
      location: {href: 'https://shop.example/checkout'},
      chrome: {
        runtime: {
          sendMessage: (msg: any, _cb: any) => sent.push(msg),
          lastError: undefined
        }
      }
    }
    const src = buildBridgeRelaySource({context: 'content'})
    expect(src).not.toContain('__EXTJS_CONTEXT__')
    run(src, fakeGlobal)
    ;(fakeGlobal.console as any).warn('hello from content', {a: 1})
    expect(sent).toHaveLength(1)
    expect(sent[0].__extjsBridgeLog).toMatchObject({
      level: 'warn',
      context: 'content',
      url: 'https://shop.example/checkout'
    })
    expect(sent[0].__extjsBridgeLog.messageParts).toEqual(['hello from content', '{"a":1}'])
  })

  it('replies BadRequest for an unknown op', () => {
    const ws = setup({})
    ws.triggerMessage({type: 'command', cmdId: 'x1', op: 'frob', target: {context: 'background'}})
    expect(results(ws).find((f) => f.cmdId === 'x1')).toMatchObject({ok: false, error: {name: 'BadRequest'}})
  })

  it('inspect of the background SW is Unsupported (no DOM)', () => {
    const ws = setup({scripting: {}})
    ws.triggerMessage({type: 'command', cmdId: 'i0', op: 'inspect', target: {context: 'background'}})
    expect(results(ws).find((f) => f.cmdId === 'i0')).toMatchObject({
      ok: false,
      error: {name: 'Unsupported'}
    })
  })

  it('SW relays a forwarded content-script log over the WS, stamping tabId from the sender', () => {
    const listeners: Array<(msg: any, sender: any) => void> = []
    const ws = setup({
      runtime: {onMessage: {addListener: (fn: any) => listeners.push(fn)}}
    })
    expect(listeners.length).toBe(1)
    // Simulate a content script forwarding console via sendMessage.
    listeners[0](
      {__extjsBridgeLog: {level: 'warn', context: 'content', messageParts: ['from content'], url: 'https://x.test/'}},
      {tab: {id: 42}, frameId: 0, url: 'https://x.test/'}
    )
    const log = ws.sent.map((s) => JSON.parse(s)).find((f) => f.type === 'log')
    expect(log.event).toMatchObject({
      level: 'warn',
      context: 'content',
      tabId: 42,
      url: 'https://x.test/',
      messageParts: ['from content']
    })
  })

  it('inspect of a content tab extracts a DOM snapshot via chrome.scripting', async () => {
    const ws = setup({
      scripting: {
        executeScript: (opts: any) =>
          // Simulate the injected extractor returning a snapshot.
          Promise.resolve([
            {result: {url: 'https://x.test/', title: 'X', summary: {extensionRootCount: 1, openShadowRoots: 0}}}
          ])
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'i1',
      op: 'inspect',
      target: {context: 'content', tabId: 5},
      args: {include: ['summary']}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 'i1')).toMatchObject({
      ok: true,
      value: {url: 'https://x.test/', summary: {extensionRootCount: 1}}
    })
  })
})
