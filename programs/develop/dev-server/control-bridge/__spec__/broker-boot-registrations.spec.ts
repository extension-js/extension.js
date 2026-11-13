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
})
