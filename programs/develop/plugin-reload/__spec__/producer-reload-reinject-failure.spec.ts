import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildDevProducerSource} from '../reload-lib/producer-reload'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: {data: string}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.onclose?.()
  }

  triggerMessage(obj: unknown) {
    this.onmessage?.({data: JSON.stringify(obj)})
  }
}

const BASE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'

function boot(manifest: () => Promise<unknown>) {
  const calls: string[] = []
  const warned: string[] = []
  const local: Record<string, unknown> = {}
  const chrome = {
    runtime: {
      lastError: undefined,
      reload: () => calls.push('runtime.reload'),
      getURL: (file: string) => `${BASE}${file}`,
      getManifest: () => ({}),
      onMessage: {addListener: () => {}}
    },
    tabs: {
      query: (_q: unknown, cb: (list: unknown[]) => void) => cb([]),
      reload: (id: number) => calls.push(`tabs.reload ${id}`)
    },
    scripting: {
      executeScript: () => calls.push('scripting.executeScript'),
      getRegisteredContentScripts: (
        _filter: unknown,
        cb: (list: unknown[]) => void
      ) => cb([]),
      registerContentScripts: () => calls.push('scripting.register')
    },
    storage: {
      local: {
        get: (key: string, cb: (res: Record<string, unknown>) => void) =>
          cb(key in local ? {[key]: local[key]} : {}),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(local, items)
          cb?.()
        },
        remove: (key: string, cb?: () => void) => {
          delete local[key]
          cb?.()
        }
      }
    }
  }
  const fakeGlobal: Record<string, unknown> = {
    WebSocket: FakeWebSocket,
    console: {
      log() {},
      info() {},
      warn: (...args: unknown[]) => warned.push(args.map(String).join(' ')),
      error() {},
      debug() {},
      trace() {}
    },
    chrome,
    fetch: (url: string) => {
      calls.push(`fetch ${url.slice(BASE.length)}`)

      return manifest().then((body) => ({json: () => Promise.resolve(body)}))
    },
    navigator: {userAgent: 'x'}
  }

  vi.stubGlobal('location', {protocol: 'chrome-extension:'})

  FakeWebSocket.instances = []
  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildDevProducerSource({
      session: {
        controlPort: 9999,
        instanceId: 'inst-R',
        connectableHost: ''
      },
      context: 'background'
    })
  )(fakeGlobal)

  const ws = FakeWebSocket.instances[0]
  ws.onopen?.()

  return {ws, calls, warned}
}

const edit = {
  type: 'reload',
  reloadType: 'content-scripts',
  label: 'content script (content/scripts.js)'
}

describe('bridge producer runtime, a reinject whose manifest cannot be read', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reinjects in place and leaves the extension running when the manifest reads', async () => {
    const h = boot(() => Promise.resolve({content_scripts: []}))

    h.calls.length = 0
    h.ws.triggerMessage(edit)
    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls).toContain('fetch manifest.json')
    expect(h.calls).not.toContain('runtime.reload')
    expect(h.warned).toEqual([])
  })

  it('restarts the extension and says why when the manifest fetch fails', async () => {
    const h = boot(() => Promise.reject(new Error('Failed to fetch')))

    h.calls.length = 0
    h.ws.triggerMessage(edit)
    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls).toContain('fetch manifest.json')
    expect(h.calls.filter((call) => call === 'runtime.reload')).toEqual([
      'runtime.reload'
    ])

    expect(h.warned).toEqual([
      'Extension.js: manifest.json could not be read to reinject the content scripts, so the extension reloads instead. Error: Failed to fetch'
    ])
  })

  it('restarts the extension when the manifest is not JSON', async () => {
    const h = boot(() =>
      Promise.resolve(undefined).then(() => {
        throw new SyntaxError('Unexpected token <')
      })
    )

    h.calls.length = 0
    h.ws.triggerMessage(edit)
    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls.filter((call) => call === 'runtime.reload')).toHaveLength(1)
    expect(h.warned[0]).toContain('SyntaxError: Unexpected token <')
  })
})
