import {describe, it, expect} from 'vitest'
import {LogRingBuffer} from '../ring-buffer'
import type {IncomingLogEvent} from '../contracts'

function evt(message: string): IncomingLogEvent {
  return {
    v: 1,
    id: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    level: 'info',
    context: 'background',
    messageParts: [message],
    runId: 'test-run'
  }
}

describe('LogRingBuffer', () => {
  it('assigns a monotonic seq starting at 1', () => {
    const ring = new LogRingBuffer(10)
    expect(ring.push(evt('a')).seq).toBe(1)
    expect(ring.push(evt('b')).seq).toBe(2)
    expect(ring.push(evt('c')).seq).toBe(3)
    expect(ring.nextSequence).toBe(4)
  })

  it('stamps the schema version on push', () => {
    const ring = new LogRingBuffer()
    expect(ring.push(evt('a')).v).toBe(1)
  })

  it('drops oldest when over capacity but keeps assigning seq', () => {
    const ring = new LogRingBuffer(3)
    for (let i = 0; i < 5; i++) ring.push(evt(`m${i}`))
    expect(ring.size).toBe(3)
    const seqs = ring.snapshot().map((e) => e.seq)
    expect(seqs).toEqual([3, 4, 5]) // first two dropped
    expect(ring.bufferedFrom).toBe(3)
    expect(ring.nextSequence).toBe(6)
  })

  it('accounts dropped events and resets on drain', () => {
    const ring = new LogRingBuffer(2)
    ring.push(evt('a'))
    ring.push(evt('b'))
    ring.push(evt('c')) // drops 1
    ring.push(evt('d')) // drops 1
    const gap = ring.drainDropped()
    expect(gap).toEqual({dropped: 2, reason: 'ring_overflow', sinceSeq: 3})
    // drain resets
    expect(ring.drainDropped()).toBeNull()
  })

  it('returns null gap when nothing dropped', () => {
    const ring = new LogRingBuffer(10)
    ring.push(evt('a'))
    expect(ring.drainDropped()).toBeNull()
  })

  it('since(seq) returns only newer retained events', () => {
    const ring = new LogRingBuffer(10)
    for (let i = 0; i < 5; i++) ring.push(evt(`m${i}`)) // seq 1..5
    expect(ring.since(3).map((e) => e.seq)).toEqual([4, 5])
    expect(ring.since(0).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('snapshot is a copy, not the internal buffer', () => {
    const ring = new LogRingBuffer(10)
    ring.push(evt('a'))
    const snap = ring.snapshot()
    snap.push({} as never)
    expect(ring.size).toBe(1)
  })

  it('bufferedFrom equals nextSequence when empty', () => {
    const ring = new LogRingBuffer(10)
    expect(ring.bufferedFrom).toBe(1)
    expect(ring.bufferedFrom).toBe(ring.nextSequence)
  })
})
