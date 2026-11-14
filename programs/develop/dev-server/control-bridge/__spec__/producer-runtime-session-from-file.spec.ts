import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildBridgeProducerSource} from '../producer-runtime'

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
}

type Control = {port: number; instanceId: string} | null

// A background the build baked no session into. It learns the port and the
// instance id from the control file of the dist, read from disk on each fetch.
function boot(options: {control: Control[]; sessionFromFile?: boolean}) {
  const controls = [...options.control]
  const fetched: string[] = []
  const consoleRef = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {}
  }
  const area = () => ({
    get: (_key: string, done: (res: Record<string, unknown>) => void) =>
      done({}),
    set: (_items: Record<string, unknown>, done?: () => void) => done?.(),
    remove: () => undefined
  })
  const fakeGlobal: Record<string, unknown> = {
    WebSocket: FakeWebSocket,
    console: consoleRef,
    chrome: {
      runtime: {
        lastError: undefined,
        getURL: (file: string) => `chrome-extension://abc/${file}`
      },
      storage: {local: area(), session: area()}
    },
    fetch: (url: string) => {
      fetched.push(url)
      const control = controls.length > 1 ? controls.shift() : controls[0]

      return control
        ? Promise.resolve({json: () => Promise.resolve(control)})
        : Promise.reject(new Error('no such file'))
    },
    navigator: {userAgent: 'x'}
  }

  vi.stubGlobal('location', {protocol: 'chrome-extension:'})
  FakeWebSocket.instances = []
  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildBridgeProducerSource({
      controlPort: 7777,
      instanceId: 'baked-instance',
      sessionFromFile: options.sessionFromFile ?? true,
      context: 'background'
    })
  )(fakeGlobal)

  const frames = (ws: FakeWebSocket) =>
    ws.sent.map((text) => JSON.parse(text) as Record<string, any>)

  return {fetched, frames, console: consoleRef as Record<string, Function>}
}

describe('bridge producer runtime, a session read from the control file', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // The bytes a kept profile caches must not differ between two sessions.
  it('names neither the port nor the instance id in its source', () => {
    const source = (port: number, instanceId: string) =>
      buildBridgeProducerSource({
        controlPort: port,
        instanceId,
        sessionFromFile: true,
        context: 'background'
      })

    expect(source(7777, 'session-one')).toBe(source(8888, 'session-two'))
    expect(source(7777, 'session-one')).not.toContain('session-one')
    expect(source(7777, 'session-one')).not.toContain('7777')
  })

  it('still names both when the build bakes the session', () => {
    const source = buildBridgeProducerSource({
      controlPort: 7777,
      instanceId: 'session-one',
      context: 'background'
    })

    expect(source).toContain('"7777"')
    expect(source).toContain('"session-one"')
  })

  it('dials the port of the control file and says its instance id', async () => {
    const h = boot({control: [{port: 9100, instanceId: 'this-session'}]})

    expect(FakeWebSocket.instances).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(0)

    expect(h.fetched).toEqual([
      'chrome-extension://abc/extension-js-control.json'
    ])

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe(
      'ws://127.0.0.1:9100/extjs-control'
    )

    FakeWebSocket.instances[0].onopen?.()

    expect(h.frames(FakeWebSocket.instances[0])[0]).toMatchObject({
      type: 'hello',
      role: 'producer',
      instanceId: 'this-session'
    })
  })

  it('reads the file again instead of dialing with no session', async () => {
    const h = boot({control: [null, {port: 9100, instanceId: 'this-session'}]})

    await vi.advanceTimersByTimeAsync(0)

    expect(FakeWebSocket.instances).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000)

    expect(h.fetched.length).toBeGreaterThan(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toContain(':9100/')
  })

  // A line logged while the file is still being read has no session yet.
  it('gives a line logged before the read the instance id it read', async () => {
    const h = boot({control: [{port: 9100, instanceId: 'this-session'}]})

    h.console.error('thrown at the top of the background')
    await vi.advanceTimersByTimeAsync(0)
    FakeWebSocket.instances[0].onopen?.()
    await vi.advanceTimersByTimeAsync(0)

    const logs = h
      .frames(FakeWebSocket.instances[0])
      .filter((frame) => frame.type === 'log')

    expect(logs).toHaveLength(1)
    expect(logs[0].event.runId).toBe('this-session')
  })

  // A dev server that restarted wrote a new session, and a background that
  // kept running takes it from the same file.
  it('takes the next session from the file after the server went away', async () => {
    const h = boot({
      control: [
        {port: 9100, instanceId: 'first-session'},
        {port: 9200, instanceId: 'second-session'}
      ]
    })

    await vi.advanceTimersByTimeAsync(0)
    FakeWebSocket.instances[0].onopen?.()
    FakeWebSocket.instances[0].close()
    await vi.advanceTimersByTimeAsync(300)
    FakeWebSocket.instances[1].close()
    await vi.advanceTimersByTimeAsync(2000)

    const last = FakeWebSocket.instances.at(-1) as FakeWebSocket

    expect(last.url).toContain(':9200/')

    last.onopen?.()

    expect(h.frames(last)[0]).toMatchObject({
      type: 'hello',
      instanceId: 'second-session'
    })
  })

  it('dials at once, with the baked session, when the build bakes one', () => {
    boot({control: [null], sessionFromFile: false})

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe(
      'ws://127.0.0.1:7777/extjs-control'
    )

    FakeWebSocket.instances[0].onopen?.()

    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toMatchObject({
      instanceId: 'baked-instance'
    })
  })
})
