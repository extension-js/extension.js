import {describe, expect, it, vi} from 'vitest'
import {dispatchReload} from '../../../plugin-reload/reload-dispatch'
import {BridgeBroker, type BridgeConnection} from '../broker'
import type {ServerFrame} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: ServerFrame[] = []
  constructor(readonly id: string) {}
  send(frame: ServerFrame) {
    this.sent.push(frame)

    return true
  }
  close() {}
}

function makeScheduler() {
  const tasks = new Map<number, () => void>()
  let id = 0

  return {
    setTimer: (fn: () => void) => {
      const handle = ++id
      tasks.set(handle, fn)

      return handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (h: ReturnType<typeof setTimeout>) => {
      tasks.delete(h as unknown as number)
    },
    fireAll: () => {
      for (const [handle, fn] of [...tasks]) {
        tasks.delete(handle)
        fn()
      }
    }
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function hello(b: BridgeBroker, conn: FakeConn) {
  b.onFrame(conn, {
    type: 'hello',
    v: 1,
    role: 'producer',
    instanceId: 'inst-1'
  } as never)
}

const EDIT = {
  type: 'content-scripts' as const,
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['content/scripts.js'],
  label: 'content_script (content/scripts.js)'
}

// Firefox suspends an idle event page and its producer with it. The clock
// starts past the startup grace window, as an edit after a quiet spell does.
function suspendedFirefox(wakeExecutor?: () => Promise<boolean>) {
  const scheduler = makeScheduler()
  let now = 0
  const b = new BridgeBroker({
    instanceId: 'inst-1',
    runId: 'run-A',
    engine: 'firefox',
    now: () => now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...(wakeExecutor ? {wakeExecutor} : {})
  } as never)
  const page = new FakeConn('event-page')
  hello(b, page)
  b.onClose(page)
  now = 60_000

  return {b, scheduler}
}

function reloadFrames(conn: FakeConn) {
  return conn.sent.filter((frame) => frame.type === 'reload')
}

describe('an edit dispatched while the Firefox event page is suspended', () => {
  it('wakes the page, hands it the edit and prints no undelivered warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const woken = new FakeConn('woken-page')
    let broker: BridgeBroker | undefined
    const wakeExecutor = vi.fn(async () => {
      setImmediate(() => hello(broker as BridgeBroker, woken))

      return true
    })
    const {b} = suspendedFirefox(wakeExecutor)
    broker = b

    await dispatchReload(EDIT, {broker: b})

    expect(wakeExecutor).toHaveBeenCalledTimes(1)
    expect(reloadFrames(woken)).toHaveLength(1)
    expect(reloadFrames(woken)[0]).toMatchObject({
      reloadType: 'content-scripts',
      label: EDIT.label
    })

    expect(warn).not.toHaveBeenCalled()
    expect(log.mock.calls.join(' ')).toContain(`Reloading ${EDIT.label}`)

    warn.mockRestore()
    log.mockRestore()
  })

  it('takes a hello that lands while the wake request is still out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const woken = new FakeConn('woken-page')
    let broker: BridgeBroker | undefined
    const {b, scheduler} = suspendedFirefox(async () => {
      hello(broker as BridgeBroker, woken)

      return true
    })
    broker = b

    await dispatchReload(EDIT, {broker: b})
    scheduler.fireAll()

    expect(reloadFrames(woken)).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
    log.mockRestore()
  })

  it('warns once when the wake brings no page back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {b, scheduler} = suspendedFirefox(async () => true)

    const dispatched = dispatchReload(EDIT, {broker: b})
    await flush()
    scheduler.fireAll()
    await dispatched

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SW not attached')

    warn.mockRestore()
  })

  it('warns when the browser cannot be asked to wake it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {b} = suspendedFirefox(async () => false)

    await dispatchReload(EDIT, {broker: b})

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SW not attached')

    warn.mockRestore()
  })

  it('asks for no wake while a producer is connected', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wakeExecutor = vi.fn(async () => true)
    const {b} = suspendedFirefox(wakeExecutor)
    const page = new FakeConn('awake-page')
    hello(b, page)

    await dispatchReload(EDIT, {broker: b})

    expect(wakeExecutor).not.toHaveBeenCalled()
    expect(reloadFrames(page)).toHaveLength(1)

    log.mockRestore()
  })

  it('asks for no wake before any producer has connected', async () => {
    const wakeExecutor = vi.fn(async () => true)
    const b = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-A',
      engine: 'firefox',
      wakeExecutor
    } as never)

    expect(b.broadcastReload(EDIT)).toBe(0)
    expect(await b.deliverLatchedReload()).toBe(false)
    expect(wakeExecutor).not.toHaveBeenCalled()
  })
})
