import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
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

const opts = {instanceId: 'inst-1', runId: 'run-A', engine: 'chromium' as const}

function hello(b: BridgeBroker, conn: FakeConn, role: 'producer' | 'consumer') {
  b.onFrame(conn, {type: 'hello', v: 1, role, instanceId: 'inst-1'})
}

describe('the wait for the registrations a background makes as it starts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds until the background says its registry calls answered', async () => {
    const b = new BridgeBroker(opts)
    const worker = new FakeConn('worker')
    const settled = vi.fn()

    void b.awaitBootRegistrations(5000).then(settled)
    hello(b, worker, 'producer')
    await vi.advanceTimersByTimeAsync(1200)

    expect(settled).not.toHaveBeenCalled()

    b.onFrame(worker, {type: 'boot-registrations', calls: 2, landed: true})
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toHaveBeenCalledWith('settled')
  })

  // A session never hangs on a background that says nothing.
  it('answers timeout when no background reports inside the wait', async () => {
    const b = new BridgeBroker(opts)
    const settled = vi.fn()

    void b.awaitBootRegistrations(5000).then(settled)
    await vi.advanceTimersByTimeAsync(4999)

    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(settled).toHaveBeenCalledWith('timeout')
  })

  it('answers at once when the report came before anyone waited', async () => {
    const b = new BridgeBroker(opts)
    const worker = new FakeConn('worker')

    hello(b, worker, 'producer')
    b.onFrame(worker, {type: 'boot-registrations', calls: 0, landed: false})

    await expect(b.awaitBootRegistrations(5000)).resolves.toBe('settled')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind once the report arrives', async () => {
    const b = new BridgeBroker(opts)
    const worker = new FakeConn('worker')
    const waiting = b.awaitBootRegistrations(5000)

    hello(b, worker, 'producer')
    b.onFrame(worker, {type: 'boot-registrations'})

    await expect(waiting).resolves.toBe('settled')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes the report from a background only', async () => {
    const b = new BridgeBroker(opts)
    const reader = new FakeConn('reader')
    const stranger = new FakeConn('stranger')
    const settled = vi.fn()

    hello(b, reader, 'consumer')
    void b.awaitBootRegistrations(1000).then(settled)
    b.onFrame(reader, {type: 'boot-registrations'})
    b.onFrame(stranger, {type: 'boot-registrations'})
    await vi.advanceTimersByTimeAsync(999)

    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(settled).toHaveBeenCalledWith('timeout')
  })

  // The background gave up on a call of its own, and the session says the
  // page opened first instead of waiting out its own timer.
  it('answers timeout when the background reports a call still unanswered', async () => {
    const b = new BridgeBroker(opts)
    const worker = new FakeConn('worker')
    const waiting = b.awaitBootRegistrations(5000)

    hello(b, worker, 'producer')
    b.onFrame(worker, {
      type: 'boot-registrations',
      calls: 1,
      landed: false,
      pending: true
    })

    await expect(waiting).resolves.toBe('timeout')
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('a registration that lands after the page was let go', () => {
    function held(late: (afterMs?: number) => void) {
      const b = new BridgeBroker({...opts, onLateBootRegistration: late})
      const worker = new FakeConn('worker')

      hello(b, worker, 'producer')

      return {b, worker}
    }

    it('is said once, with how long after the start it landed', async () => {
      const late = vi.fn()
      const {b, worker} = held(late)
      const waiting = b.awaitBootRegistrations(5000)

      b.onFrame(worker, {type: 'boot-registrations', calls: 0, landed: false})
      await waiting
      b.onFrame(worker, {type: 'boot-registrations', late: true, afterMs: 1240})
      b.onFrame(worker, {type: 'boot-registrations', late: true, afterMs: 2000})

      expect(late.mock.calls).toEqual([[1240]])
    })

    // No page waited, so no page opened without the script.
    it('is not said when no page was held for the background', () => {
      const late = vi.fn()
      const {b, worker} = held(late)

      b.onFrame(worker, {type: 'boot-registrations', calls: 0, landed: false})
      b.onFrame(worker, {type: 'boot-registrations', late: true, afterMs: 900})

      expect(late).not.toHaveBeenCalled()
    })

    // The session already said the page opened before the registrations.
    it('is not said after a wait that ended on a call still unanswered', async () => {
      const late = vi.fn()
      const {b, worker} = held(late)
      const waiting = b.awaitBootRegistrations(5000)

      b.onFrame(worker, {type: 'boot-registrations', pending: true})
      await waiting
      b.onFrame(worker, {type: 'boot-registrations', late: true, afterMs: 4400})

      expect(late).not.toHaveBeenCalled()
    })

    // A background that started again later has no first page behind it.
    it('is not taken from a background the page was not held for', async () => {
      const late = vi.fn()
      const {b, worker} = held(late)
      const restarted = new FakeConn('restarted')
      const waiting = b.awaitBootRegistrations(5000)

      b.onFrame(worker, {type: 'boot-registrations', calls: 0, landed: false})
      await waiting
      hello(b, restarted, 'producer')
      b.onFrame(restarted, {type: 'boot-registrations', calls: 1, landed: true})
      b.onFrame(restarted, {
        type: 'boot-registrations',
        late: true,
        afterMs: 300
      })

      expect(late).not.toHaveBeenCalled()
    })

    it('never lets a line that failed to print disturb the bridge', async () => {
      const {b, worker} = held(() => {
        throw new Error('closed stream')
      })
      const waiting = b.awaitBootRegistrations(5000)

      b.onFrame(worker, {type: 'boot-registrations', calls: 0, landed: false})
      await waiting

      expect(() =>
        b.onFrame(worker, {type: 'boot-registrations', late: true})
      ).not.toThrow()
    })
  })
})
