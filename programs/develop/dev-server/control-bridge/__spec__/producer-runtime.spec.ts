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
    expect(
      buildBridgeProducerSource({controlPort: null, instanceId: 'x'})
    ).toBe('')
    expect(buildBridgeProducerSource({controlPort: 0, instanceId: 'x'})).toBe(
      ''
    )
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

  it('bakes a connectable host into the control WS URL (defaults to loopback)', () => {
    const local = buildBridgeProducerSource({
      controlPort: 8147,
      instanceId: 'inst-T'
    })
    expect(local).not.toContain('__EXTJS_CONTROL_HOST__')
    expect(local).toContain('var HOST = "127.0.0.1"')

    const remote = buildBridgeProducerSource({
      controlPort: 8147,
      instanceId: 'inst-T',
      host: 'devbox.local'
    })
    expect(remote).toContain('var HOST = "devbox.local"')
  })

  it('connects to the baked host:port (not hardcoded 127.0.0.1)', () => {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    run(
      buildBridgeProducerSource({
        controlPort: 9100,
        instanceId: 'i',
        host: '10.1.2.3'
      }),
      fakeGlobal
    )
    expect(FakeWebSocket.instances[0].url).toBe(
      'ws://10.1.2.3:9100/extjs-control'
    )
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
    expect(frames[0]).toMatchObject({
      type: 'hello',
      v: 1,
      role: 'producer',
      instanceId: 'inst-T'
    })
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
    expect(originalCalls).toContainEqual({
      level: 'error',
      args: ['boom', {a: 1}]
    })
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

  it('reinjects content scripts once on install/reload (zombie-tab healing)', async () => {
    // After a dev full reload, Chrome leaves already-open tabs with the OLD
    // build's content-script DOM (nodes render, listeners dead). The producer
    // must reinject on onInstalled — and ONLY on onInstalled, so idle-stop SW
    // wakes never churn mounted UI.
    const {fakeGlobal} = makeGlobal()
    let installedListener: (() => void) | undefined
    const fetched: string[] = []
    fakeGlobal.fetch = (url: string) => {
      fetched.push(String(url))
      return Promise.resolve({json: () => Promise.resolve({content_scripts: []})})
    }
    fakeGlobal.chrome = {
      runtime: {
        id: 'test',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        onInstalled: {
          addListener: (fn: () => void) => {
            installedListener = fn
          }
        },
        onMessage: {addListener: () => {}},
        sendMessage: () => {}
      },
      scripting: {},
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    }

    const src = buildBridgeProducerSource({
      controlPort: 4004,
      instanceId: 'zombie-test'
    })
    run(src, fakeGlobal)

    expect(installedListener).toBeTypeOf('function')
    // No reinject before onInstalled fires (a plain SW wake must be a no-op).
    expect(fetched).toHaveLength(0)

    installedListener!()
    await new Promise((r) => setTimeout(r, 400))
    expect(fetched).toContain('chrome-extension://test/manifest.json')
  })

  it('honors exclude_matches on reinject and dynamic re-registration', async () => {
    // Static Chrome injection never touches excluded pages, and extensions
    // rely on that (dusk-recording opens the very page it excludes from its
    // SW message handler — dev-injecting there creates an open-tab → inject →
    // open-tab runaway loop). The reinject path must subtract excluded tabs,
    // and the dynamic registration must carry excludeMatches.
    const {fakeGlobal} = makeGlobal()
    let installedListener: (() => void) | undefined
    fakeGlobal.fetch = () =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            content_scripts: [
              {
                matches: ['<all_urls>'],
                exclude_matches: ['*://*/_screenrecording*'],
                js: ['content_scripts/content-0.js']
              }
            ]
          })
      })
    const executed: Array<{target: {tabId: number}}> = []
    const registered: Array<Record<string, unknown>> = []
    fakeGlobal.chrome = {
      runtime: {
        id: 'test',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        onInstalled: {
          addListener: (fn: () => void) => {
            installedListener = fn
          }
        },
        onMessage: {addListener: () => {}},
        sendMessage: () => {}
      },
      scripting: {
        executeScript: (opts: {target: {tabId: number}}, cb?: () => void) => {
          executed.push(opts)
          cb && cb()
        },
        insertCSS: (_o: unknown, cb?: () => void) => cb && cb(),
        registerContentScripts: (
          scripts: Array<Record<string, unknown>>,
          cb?: () => void
        ) => {
          registered.push(...scripts)
          cb && cb()
        },
        getRegisteredContentScripts: (cb: (s: unknown[]) => void) => cb([]),
        updateContentScripts: (_s: unknown, cb?: () => void) => cb && cb()
      },
      tabs: {
        query: (
          q: {url?: string[]},
          cb: (t: Array<{id: number; url: string}>) => void
        ) => {
          const urls = Array.isArray(q.url) ? q.url : []
          if (urls.includes('*://*/_screenrecording*')) {
            // the exclude query — only the bootstrap tab matches
            cb([{id: 7, url: 'http://127.0.0.1:5151/_screenrecording/boot'}])
          } else {
            // the matches query — both tabs match <all_urls>
            cb([
              {id: 1, url: 'http://127.0.0.1:5151/probe.html'},
              {id: 7, url: 'http://127.0.0.1:5151/_screenrecording/boot'}
            ])
          }
        }
      }
    }

    const src = buildBridgeProducerSource({
      controlPort: 4004,
      instanceId: 'exclude-test'
    })
    run(src, fakeGlobal)
    expect(installedListener).toBeTypeOf('function')
    installedListener!()
    await new Promise((r) => setTimeout(r, 400))

    // Only the non-excluded tab received the fresh script.
    expect(executed).toHaveLength(1)
    expect(executed[0].target.tabId).toBe(1)
    // The dynamic registration is no broader than the static one.
    expect(registered).toHaveLength(1)
    expect(registered[0].excludeMatches).toEqual(['*://*/_screenrecording*'])
  })

  it('source has no unresolved placeholders by construction', () => {
    expect(BRIDGE_PRODUCER_SOURCE).toContain('__EXTJS_CONTROL_PORT__')
  })
})

describe('bridge producer runtime — executor (Slice 2)', () => {
  function setup(
    chromeApi: Record<string, unknown>,
    extraGlobals: Record<string, unknown> = {}
  ) {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    fakeGlobal.chrome = chromeApi
    fakeGlobal.navigator = {userAgent: 'Chrome'}
    fakeGlobal.setTimeout = (fn: () => void) => {
      fn()
      return 0
    }
    Object.assign(fakeGlobal, extraGlobals)
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
    expect(results(ws).find((f) => f.cmdId === 'e1')).toMatchObject({
      ok: true,
      value: 3
    })
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

  it('open action: opens the popup when the action has a default_popup', async () => {
    let opened = false
    const ws = setup({
      action: {
        getPopup: (_d: unknown, cb: (p: string) => void) => cb('popup.html'),
        openPopup: () => {
          opened = true
          return Promise.resolve()
        },
        onClicked: {addListener() {}}
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'act1',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(opened).toBe(true)
    expect(results(ws).find((f) => f.cmdId === 'act1')).toMatchObject({
      ok: true,
      value: {triggered: 'popup'}
    })
  })

  it('open action: fires captured onClicked listeners when there is no popup', async () => {
    const fired: unknown[] = []
    const chromeApi: Record<string, any> = {
      action: {
        getPopup: (_d: unknown, cb: (p: string) => void) => cb(''),
        openPopup: () => Promise.resolve(),
        onClicked: {addListener() {}}
      },
      tabs: {
        query: (_q: unknown, cb: (t: unknown[]) => void) =>
          cb([{id: 7, active: true}])
      }
    }
    const ws = setup(chromeApi)
    // User code registers its handler AFTER the producer wrapped addListener
    // (the producer is prepended, so it always wraps first in real builds).
    chromeApi.action.onClicked.addListener((tab: unknown) => fired.push(tab))
    ws.triggerMessage({
      type: 'command',
      cmdId: 'act2',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(fired).toEqual([{id: 7, active: true}])
    expect(results(ws).find((f) => f.cmdId === 'act2')).toMatchObject({
      ok: true,
      value: {triggered: 'onClicked', listeners: 1, gesture: false}
    })
  })

  it('open action: warns when the manifest declares activeTab (no gesture grant)', async () => {
    const chromeApi: Record<string, any> = {
      action: {
        getPopup: (_d: unknown, cb: (p: string) => void) => cb(''),
        openPopup: () => Promise.resolve(),
        onClicked: {addListener() {}}
      },
      tabs: {
        query: (_q: unknown, cb: (t: unknown[]) => void) =>
          cb([{id: 1, active: true}])
      },
      runtime: {getManifest: () => ({permissions: ['activeTab', 'storage']})}
    }
    const ws = setup(chromeApi)
    chromeApi.action.onClicked.addListener(() => {})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'act-warn',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })
    await Promise.resolve()
    await Promise.resolve()
    const r = results(ws).find((f) => f.cmdId === 'act-warn')
    expect(r).toMatchObject({ok: true, value: {gesture: false}})
    expect(typeof r.value.warning).toBe('string')
    expect(r.value.warning).toMatch(/activeTab/)
  })

  it('open command: replays a captured chrome.commands.onCommand listener', async () => {
    const got: Array<[unknown, unknown]> = []
    const chromeApi: Record<string, any> = {
      commands: {onCommand: {addListener() {}}},
      tabs: {
        query: (_q: unknown, cb: (t: unknown[]) => void) =>
          cb([{id: 9, active: true}])
      }
    }
    const ws = setup(chromeApi)
    chromeApi.commands.onCommand.addListener((name: unknown, tab: unknown) =>
      got.push([name, tab])
    )
    ws.triggerMessage({
      type: 'command',
      cmdId: 'cmd1',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'command', name: 'do-thing'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(got).toEqual([['do-thing', {id: 9, active: true}]])
    expect(results(ws).find((f) => f.cmdId === 'cmd1')).toMatchObject({
      ok: true,
      value: {
        triggered: 'command',
        command: 'do-thing',
        listeners: 1,
        gesture: false
      }
    })
  })

  it('open command: Unsupported when no onCommand listener is registered', async () => {
    const ws = setup({commands: {onCommand: {addListener() {}}}})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'cmd2',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'command', name: 'noop'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 'cmd2')).toMatchObject({
      ok: false,
      error: {name: 'Unsupported'}
    })
  })

  it('open action: Unsupported when the action has neither popup nor listener', async () => {
    const ws = setup({
      action: {
        getPopup: (_d: unknown, cb: (p: string) => void) => cb(''),
        openPopup: () => Promise.resolve(),
        onClicked: {addListener() {}}
      },
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'act3',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 'act3')).toMatchObject({
      ok: false,
      error: {name: 'Unsupported'}
    })
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
    listeners[0](
      {__extjsInspectRequest: true, target: {context: 'options'}},
      {},
      (r: any) => (responded = r)
    )
    expect(responded).toBe('NONE')

    // Matching context → DOM snapshot.
    listeners[0](
      {
        __extjsInspectRequest: true,
        target: {context: 'popup'},
        args: {include: ['summary']}
      },
      {},
      (r: any) => (responded = r)
    )
    expect(responded).toMatchObject({
      ok: true,
      value: {context: 'popup', title: 'Popup'}
    })
    expect(responded.value.summary.bodyChildCount).toBe(1)
  })

  it('the relay (content) forwards console over a NAMED runtime.Port, never sendMessage (echo-SW loop guard)', () => {
    const sent: any[] = []
    const sendMessageCalls: any[] = []
    let connectedName: string | null = null
    const fakeGlobal: Record<string, unknown> = {
      console: {warn: () => {}},
      location: {href: 'https://shop.example/checkout'},
      chrome: {
        runtime: {
          connect: (opts: any) => {
            connectedName = opts?.name || null
            return {
              postMessage: (msg: any) => sent.push(msg),
              onDisconnect: {addListener: () => {}}
            }
          },
          sendMessage: (msg: any, _cb: any) => sendMessageCalls.push(msg),
          lastError: undefined
        }
      }
    }
    const src = buildBridgeRelaySource({context: 'content'})
    expect(src).not.toContain('__EXTJS_CONTEXT__')
    run(src, fakeGlobal)
    ;(fakeGlobal.console as any).warn('hello from content', {a: 1})
    // A subject SW that echoes every runtime MESSAGE back to its tabs must
    // never see relay traffic — sendMessage would loop it forever (family B).
    expect(sendMessageCalls).toHaveLength(0)
    expect(connectedName).toBe('__extjs-bridge-log__')
    expect(sent).toHaveLength(1)
    expect(sent[0].__extjsBridgeLog).toMatchObject({
      level: 'warn',
      context: 'content',
      url: 'https://shop.example/checkout'
    })
    expect(sent[0].__extjsBridgeLog.messageParts).toEqual([
      'hello from content',
      '{"a":1}'
    ])
  })

  it('the relay redials the port once when a stale port throws (SW restarted)', () => {
    const sent: any[] = []
    let connects = 0
    const fakeGlobal: Record<string, unknown> = {
      console: {log: () => {}},
      location: {href: 'https://x.test/'},
      chrome: {
        runtime: {
          connect: () => {
            connects++
            const stale = connects === 1
            return {
              postMessage: (msg: any) => {
                if (stale) throw new Error('Attempting to use a disconnected port object')
                sent.push(msg)
              },
              onDisconnect: {addListener: () => {}}
            }
          },
          lastError: undefined
        }
      }
    }
    run(buildBridgeRelaySource({context: 'content'}), fakeGlobal)
    ;(fakeGlobal.console as any).log('after sw restart')
    expect(connects).toBe(2)
    expect(sent).toHaveLength(1)
    expect(sent[0].__extjsBridgeLog.messageParts).toEqual(['after sw restart'])
  })

  it('replies BadRequest for an unknown op', () => {
    const ws = setup({})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'x1',
      op: 'frob',
      target: {context: 'background'}
    })
    expect(results(ws).find((f) => f.cmdId === 'x1')).toMatchObject({
      ok: false,
      error: {name: 'BadRequest'}
    })
  })

  it('inspect of the background SW is Unsupported (no DOM)', () => {
    const ws = setup({scripting: {}})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'i0',
      op: 'inspect',
      target: {context: 'background'}
    })
    expect(results(ws).find((f) => f.cmdId === 'i0')).toMatchObject({
      ok: false,
      error: {name: 'Unsupported'}
    })
  })

  it('SW ships port-relayed content logs over the WS, stamping tabId from the port sender', () => {
    const connectListeners: Array<(port: any) => void> = []
    const ws = setup({
      runtime: {
        onConnect: {addListener: (fn: any) => connectListeners.push(fn)},
        onMessage: {addListener: () => {}}
      }
    })
    expect(connectListeners.length).toBe(1)
    const portMessageListeners: Array<(msg: any) => void> = []
    connectListeners[0]({
      name: '__extjs-bridge-log__',
      sender: {tab: {id: 7}, frameId: 2, url: 'https://y.test/'},
      onMessage: {addListener: (fn: any) => portMessageListeners.push(fn)}
    })
    expect(portMessageListeners.length).toBe(1)
    portMessageListeners[0]({
      __extjsBridgeLog: {
        level: 'log',
        context: 'content',
        messageParts: ['ported'],
        url: 'https://y.test/'
      }
    })
    const log = ws.sent.map((s) => JSON.parse(s)).find((f) => f.type === 'log')
    expect(log.event).toMatchObject({
      level: 'log',
      context: 'content',
      tabId: 7,
      frameId: 2,
      url: 'https://y.test/',
      messageParts: ['ported']
    })
    // foreign ports are ignored
    const before = ws.sent.length
    connectListeners[0]({
      name: 'someone-elses-port',
      onMessage: {
        addListener: () => {
          throw new Error('must not listen on foreign ports')
        }
      }
    })
    expect(ws.sent.length).toBe(before)
  })

  it('SW relays a forwarded content-script log over the WS, stamping tabId from the sender', () => {
    const listeners: Array<(msg: any, sender: any) => void> = []
    const ws = setup({
      runtime: {onMessage: {addListener: (fn: any) => listeners.push(fn)}}
    })
    expect(listeners.length).toBe(1)
    // Simulate a content script forwarding console via sendMessage.
    listeners[0](
      {
        __extjsBridgeLog: {
          level: 'warn',
          context: 'content',
          messageParts: ['from content'],
          url: 'https://x.test/'
        }
      },
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

  it('reload broadcast (content-scripts): re-injects the fresh script into open tabs in place (no extension restart)', async () => {
    const injected: Array<{tabId?: number; files: string[]; world?: string}> =
      []
    // The console announcement is a separate executeScript call carrying
    // `func`+`args` (no `files`): the "[extension.js] Reloading …" line echoed
    // into each tab's devtools console.
    const announced: Array<{tabId?: number; args?: unknown[]}> = []
    let runtimeReloaded = false
    // The on-disk manifest the SW fetches has the NEW (content-hashed) filename.
    const diskManifest = {
      content_scripts: [
        {
          matches: ['https://x.test/*'],
          js: ['content_scripts/content-0.NEWHASH.js'],
          css: []
        }
      ]
    }
    const ws = setup(
      {
        runtime: {
          reload: () => {
            runtimeReloaded = true
          },
          getURL: (p: string) => `chrome-extension://abc/${p}`,
          lastError: undefined
        },
        tabs: {
          query: (_q: unknown, cb: (t: unknown[]) => void) =>
            cb([
              {id: 11, url: 'https://x.test/a'},
              {id: 12, url: 'https://x.test/b'},
              {id: 99, url: 'about:blank'} // not injectable — must be skipped
            ])
        },
        scripting: {
          executeScript: (
            opts: {
              target: {tabId: number}
              files?: string[]
              world?: string
              func?: unknown
              args?: unknown[]
            },
            cb?: () => void
          ) => {
            if (opts.files) {
              injected.push({
                tabId: opts.target.tabId,
                files: opts.files,
                world: opts.world
              })
            } else {
              announced.push({tabId: opts.target.tabId, args: opts.args})
            }
            cb && cb()
          }
        }
      },
      {
        fetch: (_url: string) =>
          Promise.resolve({json: () => Promise.resolve(diskManifest)})
      }
    )

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'content-scripts',
      label: 'content_script (src/content/scripts.ts)'
    })
    // fetch().then().then() — let the microtasks settle.
    await new Promise((r) => setTimeout(r, 20))

    // Injected the NEW file into the two matching http tabs; skipped about:blank.
    expect(injected.map((i) => i.tabId).sort()).toEqual([11, 12])
    expect(injected[0].files).toEqual(['content_scripts/content-0.NEWHASH.js'])
    expect(injected[0].world).toBe('ISOLATED')
    // The devtools console line carries the SAME server-built label, and only
    // into injectable tabs.
    expect(announced.map((a) => a.tabId).sort()).toEqual([11, 12])
    expect(announced[0].args).toEqual([
      '[extension.js] Reloading content_script (src/content/scripts.ts)…'
    ])
    // No extension restart and no command result frame.
    expect(runtimeReloaded).toBe(false)
    expect(results(ws)).toHaveLength(0)
  })

  it('reload broadcast (content-scripts): re-registers dynamic content scripts so NEW tabs get the fresh build', async () => {
    const registered: any[] = []
    const updated: any[] = []
    let existing: Array<{id: string}> = []
    const diskManifest = {
      content_scripts: [
        {
          matches: ['https://x.test/*'],
          js: ['content_scripts/content-0.NEWHASH.js'],
          css: [],
          run_at: 'document_idle'
        }
      ]
    }
    const ws = setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`,
          lastError: undefined
        },
        tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])},
        scripting: {
          executeScript: (_o: unknown, cb?: () => void) => cb && cb(),
          getRegisteredContentScripts: (cb: (s: unknown[]) => void) =>
            cb(existing),
          registerContentScripts: (s: any[], cb?: () => void) => {
            registered.push(...s)
            cb && cb()
          },
          updateContentScripts: (s: any[], cb?: () => void) => {
            updated.push(...s)
            cb && cb()
          }
        }
      },
      {
        fetch: (_url: string) =>
          Promise.resolve({json: () => Promise.resolve(diskManifest)})
      }
    )

    // First change: nothing registered yet -> registerContentScripts.
    ws.triggerMessage({type: 'reload', reloadType: 'content-scripts'})
    await new Promise((r) => setTimeout(r, 20))
    expect(updated).toHaveLength(0)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      id: 'extjs-dev-cs-0',
      matches: ['https://x.test/*'],
      js: ['content_scripts/content-0.NEWHASH.js'],
      world: 'ISOLATED',
      runAt: 'document_idle'
    })
    // The id must not start with '_' (Chrome reserves that namespace).
    expect(registered[0].id.startsWith('_')).toBe(false)

    // Second change: the id now exists -> updateContentScripts.
    existing = [{id: 'extjs-dev-cs-0'}]
    ws.triggerMessage({type: 'reload', reloadType: 'content-scripts'})
    await new Promise((r) => setTimeout(r, 20))
    expect(registered).toHaveLength(1) // unchanged
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('extjs-dev-cs-0')
  })

  it('reload broadcast (full): restarts the extension via chrome.runtime.reload', async () => {
    let runtimeReloaded = false
    const ws = setup({
      runtime: {
        reload: () => {
          runtimeReloaded = true
        }
      }
    })

    ws.triggerMessage({type: 'reload', reloadType: 'full'})

    // The reload is deferred (150ms) so any in-flight frame — and the console
    // announcement dispatched into tabs — flushes first.
    expect(runtimeReloaded).toBe(false)
    await new Promise((r) => setTimeout(r, 250))
    expect(runtimeReloaded).toBe(true)
  })

  it('reload broadcast (service-worker): stamps the pending-reinject flag BEFORE restarting', async () => {
    // runtime.reload() does not fire onInstalled, so this flag is the only
    // signal the NEXT producer generation gets to heal open tabs whose
    // content world went stale (a shared SW+content module edit — the
    // firefox-tab-switcher regression).
    let runtimeReloaded = false
    const stored: Record<string, unknown> = {}
    const ws = setup({
      runtime: {
        reload: () => {
          runtimeReloaded = true
        }
      },
      storage: {
        local: {
          set: (items: Record<string, unknown>, cb?: () => void) => {
            Object.assign(stored, items)
            cb && cb()
          }
        }
      }
    })

    ws.triggerMessage({type: 'reload', reloadType: 'service-worker'})

    // The flag lands synchronously, before the deferred restart.
    expect(typeof stored.__extjsDevPendingReinject).toBe('number')
    expect(runtimeReloaded).toBe(false)
    await new Promise((r) => setTimeout(r, 250))
    expect(runtimeReloaded).toBe(true)
  })

  it('producer boot consumes a fresh pending-reinject flag and heals open tabs', async () => {
    // The post-reload producer generation: no onInstalled ever fires for a
    // dev-driven runtime.reload(), so the boot path must reinject from the
    // storage flag — and clear it so idle-stop SW wakes stay no-ops.
    const removed: string[] = []
    const fetched: string[] = []
    setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`
        },
        storage: {
          local: {
            get: (
              key: string,
              cb: (res: Record<string, unknown>) => void
            ) => cb({[key]: Date.now()}),
            remove: (key: string, cb?: () => void) => {
              removed.push(key)
              cb && cb()
            }
          }
        },
        tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])},
        scripting: {}
      },
      {
        fetch: (url: string) => {
          fetched.push(String(url))
          return Promise.resolve({
            json: () => Promise.resolve({content_scripts: []})
          })
        }
      }
    )

    await new Promise((r) => setTimeout(r, 400))
    expect(removed).toEqual(['__extjsDevPendingReinject'])
    expect(fetched).toContain('chrome-extension://abc/manifest.json')
  })

  it('producer boot drops a STALE pending-reinject flag without reinjecting', async () => {
    // A flag left behind by a crashed session must not churn mounted UI on
    // the next unrelated boot: clear it, reinject nothing.
    const removed: string[] = []
    const fetched: string[] = []
    setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`
        },
        storage: {
          local: {
            get: (
              key: string,
              cb: (res: Record<string, unknown>) => void
            ) => cb({[key]: Date.now() - 60_000}),
            remove: (key: string, cb?: () => void) => {
              removed.push(key)
              cb && cb()
            }
          }
        },
        tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])},
        scripting: {}
      },
      {
        fetch: (url: string) => {
          fetched.push(String(url))
          return Promise.resolve({
            json: () => Promise.resolve({content_scripts: []})
          })
        }
      }
    )

    await new Promise((r) => setTimeout(r, 400))
    expect(removed).toEqual(['__extjsDevPendingReinject'])
    expect(fetched).toHaveLength(0)
  })

  it('reload broadcast (content-scripts): falls back to a full reload when chrome.scripting is unavailable', async () => {
    let runtimeReloaded = false
    // No chrome.scripting (e.g. an MV2/Firefox build) -> can't re-inject in
    // place, so restart the extension instead.
    const ws = setup({
      runtime: {
        reload: () => {
          runtimeReloaded = true
        }
      },
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    })

    ws.triggerMessage({type: 'reload', reloadType: 'content-scripts'})

    await new Promise((r) => setTimeout(r, 250))
    expect(runtimeReloaded).toBe(true)
  })

  it('reload broadcast (page): notify-only — no extension reload, no tab console line, companion still pinged', async () => {
    const external: Array<{id: string; msg: any}> = []
    const execCalls: unknown[] = []
    let runtimeReloaded = false
    const ws = setup({
      runtime: {
        reload: () => {
          runtimeReloaded = true
        },
        sendMessage: (id: string, msg: unknown, cb?: () => void) => {
          external.push({id, msg})
          cb && cb()
        },
        lastError: undefined
      },
      tabs: {
        query: (_q: unknown, cb: (t: unknown[]) => void) =>
          cb([{id: 1, url: 'https://x.test/'}])
      },
      scripting: {
        executeScript: (opts: unknown, cb?: () => void) => {
          execCalls.push(opts)
          cb && cb()
        }
      }
    })

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'page',
      label: 'sidebar page (src/sidebar/index.tsx)'
    })
    await new Promise((r) => setTimeout(r, 250))

    // livereload owns the page refresh: the producer must not reload the
    // extension or console-spam web tabs for a page-only edit…
    expect(runtimeReloaded).toBe(false)
    expect(execCalls).toHaveLength(0)
    // …but the devtools companion pill still mirrors the dev loop.
    expect(external).toHaveLength(1)
    expect(external[0].msg).toMatchObject({
      type: 'extjs-dev-reload-state',
      phase: 'reloading',
      label: 'sidebar page (src/sidebar/index.tsx)',
      kind: 'page'
    })
  })

  it('reload broadcast (content-scripts): confirms "reloaded" to the devtools companion after reinjection', async () => {
    const external: Array<{id: string; msg: any}> = []
    const diskManifest = {
      content_scripts: [
        {
          matches: ['https://x.test/*'],
          js: ['content_scripts/content-0.NEWHASH.js'],
          css: []
        }
      ]
    }
    const ws = setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`,
          sendMessage: (id: string, msg: unknown, cb?: () => void) => {
            external.push({id, msg})
            cb && cb()
          },
          lastError: undefined
        },
        tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])},
        scripting: {
          executeScript: (_o: unknown, cb?: () => void) => cb && cb()
        }
      },
      {
        fetch: (_url: string) =>
          Promise.resolve({json: () => Promise.resolve(diskManifest)})
      }
    )

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'content-scripts',
      label: 'content_script (src/content/scripts.ts)'
    })
    await new Promise((r) => setTimeout(r, 20))

    // reloading fires next to the action; reloaded only after reinjection ran.
    const phases = external.map((e) => e.msg.phase)
    expect(phases).toEqual(['reloading', 'reloaded'])
    for (const e of external) {
      expect(e.msg.label).toBe('content_script (src/content/scripts.ts)')
    }
  })

  it('inspect of a content tab extracts a DOM snapshot via chrome.scripting', async () => {
    const ws = setup({
      scripting: {
        executeScript: (opts: any) =>
          // Simulate the injected extractor returning a snapshot.
          Promise.resolve([
            {
              result: {
                url: 'https://x.test/',
                title: 'X',
                summary: {extensionRootCount: 1, openShadowRoots: 0}
              }
            }
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
