import {describe, expect, it} from 'vitest'
import {
  BRIDGE_PRODUCER_SOURCE,
  buildBridgeProducerSource,
  buildBridgeRelaySource
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
    this.onclose?.()
  }
  triggerOpen() {
    this.onopen?.()
  }
  triggerMessage(obj: unknown) {
    this.onmessage?.({data: JSON.stringify(obj)})
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
    const {fakeGlobal} = makeGlobal()
    let installedListener: (() => void) | undefined
    const fetched: string[] = []
    fakeGlobal.fetch = (url: string) => {
      fetched.push(String(url))
      return Promise.resolve({
        json: () => Promise.resolve({content_scripts: []})
      })
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
    expect(fetched).toHaveLength(0)

    installedListener!()
    await new Promise((r) => setTimeout(r, 400))
    expect(fetched).toContain('chrome-extension://test/manifest.json')
  })

  it('honors exclude_matches on reinject and dynamic re-registration', async () => {
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
          cb?.()
        },
        insertCSS: (_o: unknown, cb?: () => void) => cb?.(),
        registerContentScripts: (
          scripts: Array<Record<string, unknown>>,
          cb?: () => void
        ) => {
          registered.push(...scripts)
          cb?.()
        },
        getRegisteredContentScripts: (cb: (s: unknown[]) => void) => cb([]),
        updateContentScripts: (_s: unknown, cb?: () => void) => cb?.()
      },
      tabs: {
        query: (
          q: {url?: string[]},
          cb: (t: Array<{id: number; url: string}>) => void
        ) => {
          const urls = Array.isArray(q.url) ? q.url : []
          if (urls.includes('*://*/_screenrecording*')) {
            cb([{id: 7, url: 'http://127.0.0.1:5151/_screenrecording/boot'}])
          } else {
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

    expect(executed).toHaveLength(1)
    expect(executed[0].target.tabId).toBe(1)
    expect(registered).toHaveLength(1)
    expect(registered[0].excludeMatches).toEqual(['*://*/_screenrecording*'])
  })

  it('source has no unresolved placeholders by construction', () => {
    expect(BRIDGE_PRODUCER_SOURCE).toContain('__EXTJS_CONTROL_PORT__')
  })
})

describe('bridge producer runtime, executor (Slice 2)', () => {
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
    ws.sent = []
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

  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  it('eval content resolves --url to the matching tab id (#51)', async () => {
    const executed: Array<{target: {tabId: number}}> = []
    const ws = setup({
      scripting: {
        executeScript: (opts: {
          target: {tabId: number}
          func: (...a: unknown[]) => unknown
          args?: unknown[]
        }) => {
          executed.push(opts)
          return Promise.resolve([{result: opts.func(...(opts.args || []))}])
        }
      },
      tabs: {
        query: (
          q: {url?: string; active?: boolean},
          cb: (t: unknown[]) => void
        ) => {
          if (q?.url) cb([{id: 9, url: 'https://example.com/'}])
          else cb([])
        }
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-url',
      op: 'eval',
      target: {context: 'content', url: 'https://example.com/*'},
      args: {expression: '40 + 2'}
    })
    await flush()
    expect(executed).toHaveLength(1)
    expect(executed[0].target.tabId).toBe(9)
    expect(results(ws).find((f) => f.cmdId === 'e-url')).toMatchObject({
      ok: true,
      value: 42
    })
  })

  it('eval content with no --tab/--url defaults to the active tab (#51)', async () => {
    const executed: Array<{target: {tabId: number}}> = []
    const ws = setup({
      scripting: {
        executeScript: (opts: {
          target: {tabId: number}
          func: (...a: unknown[]) => unknown
          args?: unknown[]
        }) => {
          executed.push(opts)
          return Promise.resolve([{result: opts.func(...(opts.args || []))}])
        }
      },
      tabs: {
        query: (
          q: {url?: string; active?: boolean},
          cb: (t: unknown[]) => void
        ) => {
          if (q?.active) cb([{id: 5, url: 'https://active.test/'}])
          else cb([])
        }
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-active',
      op: 'eval',
      target: {context: 'content'},
      args: {expression: '1'}
    })
    await flush()
    expect(executed).toHaveLength(1)
    expect(executed[0].target.tabId).toBe(5)
  })

  it('eval content with no matching tab reports Unsupported, not a silent hang (#51)', async () => {
    const ws = setup({
      scripting: {executeScript: () => Promise.resolve([{result: 1}])},
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-none',
      op: 'eval',
      target: {context: 'content', url: 'https://nope.test/'},
      args: {expression: '1'}
    })
    await flush()
    expect(results(ws).find((f) => f.cmdId === 'e-none')).toMatchObject({
      ok: false,
      error: {name: 'Unsupported'}
    })
  })

  it('eval content: a null injection result is an error, never ok:true null (§61)', async () => {
    const ws = setup({
      scripting: {executeScript: () => Promise.resolve([{result: null}])},
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-null',
      op: 'eval',
      target: {context: 'content', tabId: 7},
      args: {expression: '1'}
    })
    await flush()
    const r = results(ws).find((f) => f.cmdId === 'e-null')
    expect(r).toMatchObject({ok: false, error: {name: 'EvalError'}})
    expect(r.error.message).toContain('never executed')
  })

  it('eval content: a CSP-blocked eval inside the tab reports Unsupported with the MAIN-world alternative (§61)', async () => {
    const ws = setup({
      scripting: {
        executeScript: () =>
          Promise.resolve([
            {
              result: {
                __extjsEval: 1,
                ok: false,
                name: 'EvalError',
                message:
                  "Refused to evaluate a string of JavaScript because 'unsafe-eval' is not allowed"
              }
            }
          ])
      },
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-csp',
      op: 'eval',
      target: {context: 'content', tabId: 7},
      args: {expression: 'console.log("x")'}
    })
    await flush()
    const r = results(ws).find((f) => f.cmdId === 'e-csp')
    expect(r).toMatchObject({ok: false, error: {name: 'Unsupported'}})
    expect(r.error.message).toContain('--context page')
  })

  it('eval popup routes through the surface relay, mirroring inspect (§62)', async () => {
    const sent: any[] = []
    const ws = setup({
      runtime: {
        sendMessage: (msg: any, cb: (r: any) => void) => {
          sent.push(msg)
          cb({ok: true, value: 7})
        },
        lastError: undefined
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-popup',
      op: 'eval',
      target: {context: 'popup'},
      args: {expression: '3 + 4'}
    })
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].__extjsEvalRequest).toBe(true)
    expect(sent[0].target.context).toBe('popup')
    expect(results(ws).find((f) => f.cmdId === 'e-popup')).toMatchObject({
      ok: true,
      value: 7
    })
  })

  it('eval popup with the surface closed reports Unsupported, not a tabId demand (§62)', async () => {
    const ws = setup({
      runtime: {
        sendMessage: (_msg: any, cb: (r: any) => void) => cb(undefined),
        lastError: undefined
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-closed',
      op: 'eval',
      target: {context: 'sidebar'},
      args: {expression: '1'}
    })
    await flush()
    const r = results(ws).find((f) => f.cmdId === 'e-closed')
    expect(r).toMatchObject({ok: false, error: {name: 'Unsupported'}})
    expect(r.error.message).toContain('not open')
    expect(r.error.message).not.toContain('tabId')
  })

  it('eval in an unknown context is BadRequest, not a tabId demand (§62)', async () => {
    const ws = setup({})
    ws.triggerMessage({
      type: 'command',
      cmdId: 'e-unknown',
      op: 'eval',
      target: {context: 'frob'},
      args: {expression: '1'}
    })
    await flush()
    expect(results(ws).find((f) => f.cmdId === 'e-unknown')).toMatchObject({
      ok: false,
      error: {name: 'BadRequest'}
    })
  })

  it('tabs.query works on a callback-only chrome.* (Gecko MV2, §70)', async () => {
    const ws = setup({
      tabs: {
        query: (_q: unknown, cb?: (t: unknown[]) => void) => {
          if (typeof cb !== 'function') return undefined
          cb([
            {
              id: 4,
              url: 'https://a.test/',
              title: 'A',
              active: true,
              windowId: 1
            }
          ])
          return undefined
        }
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 't-cb',
      op: 'tabs.query',
      target: {context: 'background'},
      args: {}
    })
    await flush()
    expect(results(ws).find((f) => f.cmdId === 't-cb')).toMatchObject({
      ok: true,
      value: [{id: 4, url: 'https://a.test/', title: 'A'}]
    })
  })

  it('tabs.query prefers the promisified browser.* namespace when present (§70)', async () => {
    let browserUsed = false
    const ws = setup(
      {
        tabs: {
          query: () => {
            throw new Error(
              'chrome.* path must not be used when browser.* exists'
            )
          }
        }
      },
      {
        browser: {
          tabs: {
            query: () => {
              browserUsed = true
              return Promise.resolve([
                {
                  id: 9,
                  url: 'https://b.test/',
                  title: 'B',
                  active: false,
                  windowId: 2
                }
              ])
            }
          }
        }
      }
    )
    ws.triggerMessage({
      type: 'command',
      cmdId: 't-browser',
      op: 'tabs.query',
      target: {context: 'background'},
      args: {}
    })
    await flush()
    expect(browserUsed).toBe(true)
    expect(results(ws).find((f) => f.cmdId === 't-browser')).toMatchObject({
      ok: true,
      value: [{id: 9}]
    })
  })

  it('tab reload works on a callback-only chrome.* (Gecko MV2, §70)', async () => {
    const reloaded: number[] = []
    const ws = setup({
      tabs: {
        reload: (id: number, cb?: () => void) => {
          reloaded.push(id)
          if (typeof cb === 'function') cb()
          return undefined
        }
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'r-cb',
      op: 'reload',
      target: {context: 'content', tabId: 12}
    })
    await flush()
    expect(reloaded).toEqual([12])
    expect(results(ws).find((f) => f.cmdId === 'r-cb')).toMatchObject({
      ok: true,
      value: {reloaded: 12}
    })
  })

  it('inspect content resolves --url to a tab and snapshots it (#51)', async () => {
    const executed: Array<{target: {tabId: number}}> = []
    const ws = setup({
      scripting: {
        executeScript: (opts: {target: {tabId: number}}) => {
          executed.push(opts)
          return Promise.resolve([{result: {url: 'https://example.com/'}}])
        }
      },
      tabs: {
        query: (q: {url?: string}, cb: (t: unknown[]) => void) => {
          if (q?.url) cb([{id: 3, url: 'https://example.com/'}])
          else cb([])
        }
      }
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 'i-url',
      op: 'inspect',
      target: {context: 'content', url: 'https://example.com/*'},
      args: {include: ['summary']}
    })
    await flush()
    expect(executed).toHaveLength(1)
    expect(executed[0].target.tabId).toBe(3)
    expect(results(ws).find((f) => f.cmdId === 'i-url')).toMatchObject({
      ok: true
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
    expect(listeners.length).toBe(2)
    const dispatch = (msg: any, respond: (r: any) => void) => {
      for (const fn of listeners) fn(msg, {}, respond)
    }

    let responded: any = 'NONE'
    dispatch(
      {__extjsInspectRequest: true, target: {context: 'options'}},
      (r: any) => (responded = r)
    )
    expect(responded).toBe('NONE')

    dispatch(
      {
        __extjsInspectRequest: true,
        target: {context: 'popup'},
        args: {include: ['summary']}
      },
      (r: any) => (responded = r)
    )
    expect(responded).toMatchObject({
      ok: true,
      value: {context: 'popup', title: 'Popup'}
    })
    expect(responded.value.summary.bodyChildCount).toBe(1)
  })

  it('the relay answers a surface eval request for its own context (§62)', () => {
    const listeners: Array<(m: any, s: any, r: any) => void> = []
    const fakeGlobal: Record<string, unknown> = {
      console: {log: () => {}},
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
    const dispatch = (msg: any, respond: (r: any) => void) => {
      for (const fn of listeners) fn(msg, {}, respond)
    }

    let responded: any = 'NONE'
    dispatch(
      {
        __extjsEvalRequest: true,
        target: {context: 'options'},
        args: {expression: '1'}
      },
      (r: any) => (responded = r)
    )
    expect(responded).toBe('NONE')

    dispatch(
      {
        __extjsEvalRequest: true,
        target: {context: 'popup'},
        args: {expression: '20 + 3'}
      },
      (r: any) => (responded = r)
    )
    expect(responded).toMatchObject({ok: true, value: 23})

    dispatch(
      {
        __extjsEvalRequest: true,
        target: {context: 'popup'},
        args: {expression: 'nope.nope'}
      },
      (r: any) => (responded = r)
    )
    expect(responded.ok).toBe(false)
    expect(responded.error.name).toBeTruthy()
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
                if (stale)
                  throw new Error(
                    'Attempting to use a disconnected port object'
                  )
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
    const announced: Array<{tabId?: number; args?: unknown[]}> = []
    let runtimeReloaded = false
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
              {id: 99, url: 'about:blank'}
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
            cb?.()
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
    await new Promise((r) => setTimeout(r, 20))

    expect(injected.map((i) => i.tabId).sort()).toEqual([11, 12])
    expect(injected[0].files).toEqual(['content_scripts/content-0.NEWHASH.js'])
    expect(injected[0].world).toBe('ISOLATED')
    expect(announced.map((a) => a.tabId).sort()).toEqual([11, 12])
    expect(announced[0].args).toEqual([
      '[extension.js] Reloading content_script (src/content/scripts.ts)…'
    ])
    expect(runtimeReloaded).toBe(false)
    expect(results(ws)).toHaveLength(0)
  })

  it('reload broadcast (content-scripts): acks receipt over the WS so the broker releases its delivery latch (bug 27)', async () => {
    const ws = setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`,
          lastError: undefined
        },
        tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])},
        scripting: {executeScript: (_o: unknown, cb?: () => void) => cb?.()}
      },
      {
        fetch: (_url: string) =>
          Promise.resolve({
            json: () => Promise.resolve({content_scripts: []})
          })
      }
    )

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'content-scripts',
      label: 'content_script (src/content/scripts.ts)'
    })
    await new Promise((r) => setTimeout(r, 20))

    const ack = ws.sent
      .map((s) => JSON.parse(s))
      .find((f) => f.type === 'reload-ack')
    expect(ack).toMatchObject({
      type: 'reload-ack',
      reloadType: 'content-scripts',
      label: 'content_script (src/content/scripts.ts)'
    })
  })

  it('reload broadcast (page): notify-only, no ack (nothing was latched)', async () => {
    const ws = setup({
      runtime: {lastError: undefined},
      tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])}
    })

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'page',
      label: 'popup page (src/popup/index.tsx)'
    })
    await new Promise((r) => setTimeout(r, 20))

    const ack = ws.sent
      .map((s) => JSON.parse(s))
      .find((f) => f.type === 'reload-ack')
    expect(ack).toBeUndefined()
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
          executeScript: (_o: unknown, cb?: () => void) => cb?.(),
          getRegisteredContentScripts: (cb: (s: unknown[]) => void) =>
            cb(existing),
          registerContentScripts: (s: any[], cb?: () => void) => {
            registered.push(...s)
            cb?.()
          },
          updateContentScripts: (s: any[], cb?: () => void) => {
            updated.push(...s)
            cb?.()
          }
        }
      },
      {
        fetch: (_url: string) =>
          Promise.resolve({json: () => Promise.resolve(diskManifest)})
      }
    )

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
    expect(registered[0].id.startsWith('_')).toBe(false)

    existing = [{id: 'extjs-dev-cs-0'}]
    ws.triggerMessage({type: 'reload', reloadType: 'content-scripts'})
    await new Promise((r) => setTimeout(r, 20))
    expect(registered).toHaveLength(1)
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

    expect(runtimeReloaded).toBe(false)
    await new Promise((r) => setTimeout(r, 250))
    expect(runtimeReloaded).toBe(true)
  })

  it('reload broadcast (service-worker): stamps the pending-reinject flag BEFORE restarting', async () => {
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
            cb?.()
          }
        }
      }
    })

    ws.triggerMessage({type: 'reload', reloadType: 'service-worker'})

    expect(typeof stored.__extjsDevPendingReinject).toBe('number')
    expect(runtimeReloaded).toBe(false)
    await new Promise((r) => setTimeout(r, 250))
    expect(runtimeReloaded).toBe(true)
  })

  it('producer boot consumes a fresh pending-reinject flag and heals open tabs', async () => {
    const removed: string[] = []
    const fetched: string[] = []
    setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`
        },
        storage: {
          local: {
            get: (key: string, cb: (res: Record<string, unknown>) => void) =>
              cb({[key]: Date.now()}),
            remove: (key: string, cb?: () => void) => {
              removed.push(key)
              cb?.()
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
    const removed: string[] = []
    const fetched: string[] = []
    setup(
      {
        runtime: {
          getURL: (p: string) => `chrome-extension://abc/${p}`
        },
        storage: {
          local: {
            get: (key: string, cb: (res: Record<string, unknown>) => void) =>
              cb({[key]: Date.now() - 60_000}),
            remove: (key: string, cb?: () => void) => {
              removed.push(key)
              cb?.()
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

  it('reload broadcast (page): notify-only, no extension reload, no tab console line, companion still pinged', async () => {
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
          cb?.()
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
          cb?.()
        }
      }
    })

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'page',
      label: 'sidebar page (src/sidebar/index.tsx)'
    })
    await new Promise((r) => setTimeout(r, 250))

    expect(runtimeReloaded).toBe(false)
    expect(execCalls).toHaveLength(0)
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
            cb?.()
          },
          lastError: undefined
        },
        tabs: {query: (_q: unknown, cb: (t: unknown[]) => void) => cb([])},
        scripting: {
          executeScript: (_o: unknown, cb?: () => void) => cb?.()
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

describe('bridge producer runtime, storage on callback-only engines (#54)', () => {
  function setup(
    chromeApi: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ) {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    fakeGlobal.chrome = chromeApi
    fakeGlobal.navigator = {userAgent: 'Firefox'}
    Object.assign(fakeGlobal, extra)
    run(
      buildBridgeProducerSource({
        controlPort: 9999,
        instanceId: 'inst-S',
        context: 'background'
      }),
      fakeGlobal
    )
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.sent = []
    return ws
  }
  const results = (ws: FakeWebSocket) =>
    ws.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'result')

  it('storage.set then storage.get round-trip via a callback-only stub', async () => {
    const store: Record<string, unknown> = {}
    const callbackOnly = {
      get: (key: string | null, cb?: (r: Record<string, unknown>) => void) => {
        if (typeof cb === 'function')
          cb(key == null ? {...store} : {[key]: store[key]})
        return undefined
      },
      set: (items: Record<string, unknown>, cb?: () => void) => {
        if (typeof cb === 'function') {
          Object.assign(store, items)
          cb()
        }
        return undefined
      }
    }
    const ws = setup({storage: {local: callbackOnly}, runtime: {}})

    ws.triggerMessage({
      type: 'command',
      cmdId: 's1',
      op: 'storage.set',
      target: {context: 'background'},
      args: {area: 'local', items: {hello: 'world'}}
    })
    await Promise.resolve()
    expect(store.hello).toBe('world')
    expect(results(ws).find((f) => f.cmdId === 's1')).toMatchObject({
      ok: true,
      value: {set: ['hello']}
    })

    ws.triggerMessage({
      type: 'command',
      cmdId: 's2',
      op: 'storage.get',
      target: {context: 'background'},
      args: {area: 'local', key: 'hello'}
    })
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 's2')).toMatchObject({
      ok: true,
      value: {hello: 'world'}
    })
  })

  it('storage.get surfaces runtime.lastError as a StorageError on the callback path', async () => {
    const callbackOnly = {
      get: (_key: string | null, cb?: (r: unknown) => void) => {
        if (typeof cb === 'function') cb(undefined)
        return undefined
      }
    }
    const ws = setup({
      storage: {local: callbackOnly},
      runtime: {lastError: {message: 'quota exceeded'}}
    })
    ws.triggerMessage({
      type: 'command',
      cmdId: 's-err',
      op: 'storage.get',
      target: {context: 'background'},
      args: {area: 'local', key: 'k'}
    })
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 's-err')).toMatchObject({
      ok: false,
      error: {name: 'StorageError'}
    })
  })

  it('prefers the promisified browser.* namespace when present (Firefox)', async () => {
    const store: Record<string, unknown> = {}
    let chromeGetCalls = 0
    const chromeArea = {
      get: (_k: string | null, cb?: (r: unknown) => void) => {
        chromeGetCalls++
        if (cb) cb({})
        return undefined
      }
    }
    const browserArea = {
      get: (key: string | null) =>
        Promise.resolve(key == null ? {...store} : {[key]: store[key]}),
      set: (items: Record<string, unknown>) => {
        Object.assign(store, items)
        return Promise.resolve()
      }
    }
    const ws = setup(
      {storage: {local: chromeArea}, runtime: {}},
      {browser: {storage: {local: browserArea}}}
    )
    chromeGetCalls = 0
    ws.triggerMessage({
      type: 'command',
      cmdId: 'b1',
      op: 'storage.set',
      target: {context: 'background'},
      args: {area: 'local', items: {a: 1}}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(store.a).toBe(1)
    ws.triggerMessage({
      type: 'command',
      cmdId: 'b2',
      op: 'storage.get',
      target: {context: 'background'},
      args: {area: 'local', key: 'a'}
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(results(ws).find((f) => f.cmdId === 'b2')).toMatchObject({
      ok: true,
      value: {a: 1}
    })
    expect(chromeGetCalls).toBe(0)
  })
})

describe('bridge producer runtime, uncaught error capture (#55)', () => {
  function setup(chromeApi: Record<string, unknown> = {}) {
    FakeWebSocket.instances = []
    const {fakeGlobal} = makeGlobal()
    fakeGlobal.chrome = chromeApi
    fakeGlobal.navigator = {userAgent: 'Chrome'}
    const handlers: Record<string, Array<(ev: unknown) => void>> = {}
    fakeGlobal.addEventListener = (type: string, fn: (ev: unknown) => void) => {
      ;(handlers[type] || (handlers[type] = [])).push(fn)
    }
    run(
      buildBridgeProducerSource({
        controlPort: 9999,
        instanceId: 'inst-U',
        context: 'background'
      }),
      fakeGlobal
    )
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()
    ws.sent = []
    return {ws, handlers, fakeGlobal}
  }
  const errorLogs = (ws: FakeWebSocket) =>
    ws.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.type === 'log' && f.event.level === 'error')

  it('forwards an uncaught error event as a single level:error log', () => {
    const {ws, handlers} = setup()
    expect(handlers.error).toHaveLength(1)
    handlers.error[0]({
      error: new Error('boom in SW'),
      message: 'boom in SW',
      filename: 'background.js'
    })
    const logs = errorLogs(ws)
    expect(logs).toHaveLength(1)
    expect(logs[0].event).toMatchObject({
      level: 'error',
      context: 'background',
      runId: 'inst-U'
    })
    expect(logs[0].event.messageParts[0]).toContain('boom in SW')
  })

  it('forwards an unhandled promise rejection as a single level:error log', () => {
    const {ws, handlers} = setup()
    expect(handlers.unhandledrejection).toHaveLength(1)
    handlers.unhandledrejection[0]({reason: new Error('rejected!')})
    const logs = errorLogs(ws)
    expect(logs).toHaveLength(1)
    expect(logs[0].event.messageParts[0]).toContain(
      'Unhandled promise rejection'
    )
    expect(logs[0].event.messageParts[0]).toContain('rejected!')
  })

  it('does not double-emit a throw already logged via console.error', () => {
    const {ws, handlers, fakeGlobal} = setup()
    const err = new Error('logged then thrown')
    ;(fakeGlobal.console as any).error(err)
    handlers.error[0]({error: err, message: err.message})
    const logs = errorLogs(ws)
    expect(logs).toHaveLength(1)
  })
})

describe('bridge relay runtime, uncaught error capture (#55)', () => {
  it('forwards a page/content uncaught error over the log port as level:error', () => {
    const sent: any[] = []
    const handlers: Record<string, Array<(ev: unknown) => void>> = {}
    const fakeGlobal: Record<string, unknown> = {
      console: {error: () => {}},
      location: {href: 'https://shop.example/checkout'},
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        ;(handlers[type] || (handlers[type] = [])).push(fn)
      },
      chrome: {
        runtime: {
          connect: () => ({
            postMessage: (msg: any) => sent.push(msg),
            onDisconnect: {addListener: () => {}}
          }),
          lastError: undefined
        }
      }
    }
    run(buildBridgeRelaySource({context: 'content'}), fakeGlobal)
    expect(handlers.error).toHaveLength(1)
    handlers.error[0]({
      error: new Error('page blew up'),
      message: 'page blew up',
      filename: 'https://shop.example/app.js'
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].__extjsBridgeLog).toMatchObject({
      level: 'error',
      context: 'content'
    })
    expect(sent[0].__extjsBridgeLog.messageParts[0]).toContain('page blew up')
  })
})
