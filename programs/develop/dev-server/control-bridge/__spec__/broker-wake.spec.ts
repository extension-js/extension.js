import {describe, expect, it, vi} from 'vitest'
import {BridgeBroker, type BridgeConnection} from '../broker'
import type {CommandFrame, ServerFrame} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: (ServerFrame | CommandFrame)[] = []
  closed: {code?: number; reason?: string} | null = null
  constructor(readonly id: string) {}
  send(frame: ServerFrame | CommandFrame) {
    this.sent.push(frame)

    return true
  }
  close(code?: number, reason?: string) {
    this.closed = {code, reason}
  }
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

function hello(b: BridgeBroker, conn: FakeConn, role: string) {
  b.onFrame(conn, {
    type: 'hello',
    v: 1,
    role,
    instanceId: 'inst-1'
  } as never)
}

function storageGet(b: BridgeBroker, ctl: FakeConn, cmdId = 'c1') {
  b.onFrame(ctl, {
    type: 'command',
    cmdId,
    op: 'storage.get',
    target: {context: 'background'},
    args: {}
  } as never)
}

// The producer of a Firefox event page leaves with the page when Firefox
// suspends it, and nothing dials back in until an extension event fires.
function suspendedFirefox(wakeExecutor?: () => Promise<boolean>) {
  const scheduler = makeScheduler()
  const b = new BridgeBroker({
    instanceId: 'inst-1',
    runId: 'run-A',
    engine: 'firefox',
    allowControl: true,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...(wakeExecutor ? {wakeExecutor} : {})
  } as never)
  const page = new FakeConn('event-page')
  hello(b, page, 'producer')
  b.onClose(page)

  const ctl = new FakeConn('ctl')
  hello(b, ctl, 'controller')
  ctl.sent = []

  return {b, ctl, scheduler}
}

describe('a control verb sent while the Firefox event page is suspended', () => {
  it('wakes the page and routes the verb to it once it reconnects', async () => {
    const wakeExecutor = vi.fn(async () => true)
    const {b, ctl} = suspendedFirefox(wakeExecutor)

    storageGet(b, ctl)
    await flush()

    expect(wakeExecutor).toHaveBeenCalledTimes(1)
    expect(ctl.sent).toEqual([])

    const woken = new FakeConn('woken-page')
    hello(b, woken, 'producer')
    await flush()

    const routed = woken.sent.find((frame) => frame.type === 'command') as
      | CommandFrame
      | undefined
    expect(routed).toMatchObject({cmdId: 'c1', op: 'storage.get'})

    b.onFrame(woken, {
      type: 'result',
      cmdId: 'c1',
      ok: true,
      value: {}
    } as never)

    expect(ctl.sent[0]).toMatchObject({type: 'result', cmdId: 'c1', ok: true})
  })

  it('names the suspension and what wakes it when the wake brings nothing back', async () => {
    const {b, ctl, scheduler} = suspendedFirefox(async () => true)

    storageGet(b, ctl)
    await flush()
    scheduler.fireAll()
    await flush()

    const result = ctl.sent[0] as {ok: boolean; error: {message: string}}
    expect(result.ok).toBe(false)
    expect(result.error.message).toContain('no executor connected')
    expect(result.error.message).toMatch(/suspended/)
    expect(result.error.message).toMatch(/toolbar button/)
    expect(result.error.message).not.toMatch(/reconnect on their own/)
  })

  it('never promises a Firefox event page reconnects on its own', () => {
    const {b, ctl} = suspendedFirefox()

    storageGet(b, ctl)

    const result = ctl.sent[0] as {ok: boolean; error: {message: string}}
    expect(result.ok).toBe(false)
    expect(result.error.message).toContain('no executor connected')
    expect(result.error.message).toMatch(/suspended/)
    expect(result.error.message).not.toMatch(/reconnect on their own/)
  })
})
