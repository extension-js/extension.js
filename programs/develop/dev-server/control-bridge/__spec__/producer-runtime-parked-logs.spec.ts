import {beforeEach, describe, expect, it} from 'vitest'
import {buildBridgeProducerSource} from '../producer-runtime'

// A Safari background woken by an event is a fresh page that can unload
// before its socket opens. Every level it wrote before that has to survive
// in storage and reach the agent through the next context, in order.

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
  triggerOpen() {
    this.onopen?.()
  }
}

type Console = Record<string, (...args: unknown[]) => void>
type Frame = {type: string; event?: Record<string, any>}

function makeStore() {
  const data: Record<string, unknown> = {}
  const clone = (v: unknown) => JSON.parse(JSON.stringify(v))
  const area = {
    get: (key: string, cb: (res: Record<string, unknown>) => void) => {
      const res: Record<string, unknown> = {}
      if (key in data) res[key] = clone(data[key])

      cb(res)
    },
    set: (items: Record<string, unknown>, cb?: () => void) => {
      for (const key of Object.keys(items)) data[key] = clone(items[key])
      cb?.()
    },
    remove: (key: string, cb?: () => void) => {
      delete data[key]
      cb?.()
    }
  }

  return {data, area}
}

function startContext(area: unknown, instanceId = 'inst-P') {
  const console: Console = {}

  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    console[level] = () => {}
  }

  const fakeGlobal: Record<string, unknown> = {
    WebSocket: FakeWebSocket,
    console,
    addEventListener: () => {},
    chrome: {storage: {local: area}, runtime: {lastError: undefined}}
  }

  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildBridgeProducerSource({
      controlPort: 9500,
      instanceId,
      context: 'background'
    })
  )(fakeGlobal)

  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

  return {ws, console}
}

const logsOf = (ws: FakeWebSocket): Frame[] =>
  ws.sent.map((s) => JSON.parse(s)).filter((f: Frame) => f.type === 'log')

const textOf = (frames: Frame[]) =>
  frames.map((f) => `${f.event?.level}:${f.event?.messageParts?.[0]}`)

const parkedOf = (data: Record<string, unknown>) =>
  (data.__extjsPendingErrors as Frame[]) || []

describe('bridge producer runtime, parked logs of every level', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  it('parks a log, info, warn and debug line the closed socket could not send', () => {
    const {data, area} = makeStore()
    const {ws, console} = startContext(area)

    console.log('Hands-free background running')
    console.info('info line')
    console.warn('warn line')
    console.debug('debug line')

    expect(ws.sent).toHaveLength(0)
    expect(textOf(parkedOf(data))).toEqual([
      'log:Hands-free background running',
      'info:info line',
      'warn:warn line',
      'debug:debug line'
    ])
  })

  it('ships what a dead context wrote before its own lines, in order', () => {
    const {data, area} = makeStore()
    const dead = startContext(area)
    dead.console.log('wake 1: background running')
    dead.console.error('wake 1: failed')
    dead.console.info('wake 1: click handled')

    const live = startContext(area)
    live.console.log('wake 2: background running')
    live.console.warn('wake 2: still waiting')
    live.ws.triggerOpen()
    live.console.log('wake 2: connected')

    const frames = live.ws.sent.map((s) => JSON.parse(s))
    expect(frames[0]).toMatchObject({type: 'hello', role: 'producer'})
    expect(textOf(logsOf(live.ws))).toEqual([
      'log:wake 1: background running',
      'error:wake 1: failed',
      'info:wake 1: click handled',
      'log:wake 2: background running',
      'warn:wake 2: still waiting',
      'log:wake 2: connected'
    ])

    expect(data.__extjsPendingErrors).toBeUndefined()
  })

  it('keeps a parked error when a flood of plain lines hits the cap', () => {
    const {data, area} = makeStore()
    const {console} = startContext(area)

    console.error('the one that matters')
    for (let i = 0; i < 150; i++) console.log(`line ${i}`)

    const parked = parkedOf(data)
    expect(parked).toHaveLength(100)
    expect(textOf(parked)[0]).toBe('error:the one that matters')
    expect(textOf(parked)[1]).toBe('log:line 51')
    expect(textOf(parked)[99]).toBe('log:line 149')
  })

  it('holds lines written during an async replay behind the earlier ones', async () => {
    const {data, area} = makeStore()
    const dead = startContext(area)
    dead.console.log('wake 1: click handled')

    const promiseArea = {
      get: (key: string) =>
        Promise.resolve(
          key in data ? {[key]: JSON.parse(JSON.stringify(data[key]))} : {}
        ),
      set: (items: Record<string, unknown>) => {
        Object.assign(data, JSON.parse(JSON.stringify(items)))

        return Promise.resolve()
      },
      remove: (key: string) => {
        delete data[key]

        return Promise.resolve()
      }
    }
    const live = startContext(promiseArea)
    for (let i = 0; i < 4; i++) await Promise.resolve()
    live.ws.triggerOpen()
    live.console.log('wake 2: logged while the replay reads')
    for (let i = 0; i < 4; i++) await Promise.resolve()

    expect(textOf(logsOf(live.ws))).toEqual([
      'log:wake 1: click handled',
      'log:wake 2: logged while the replay reads'
    ])
  })

  it('parks nothing once the socket is open', () => {
    const {data, area} = makeStore()
    const {ws, console} = startContext(area)

    ws.triggerOpen()
    console.log('live line')

    expect(textOf(logsOf(ws))).toEqual(['log:live line'])
    expect(parkedOf(data)).toHaveLength(0)
  })
})
