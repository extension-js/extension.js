/**
 * Bounded log ring for the agent bridge (SURFACE.md Part A).
 *
 * - Assigns the monotonic `seq` that consumers order by.
 * - Drop-oldest on overflow; a debugger wants recent truth, not ancient.
 * - Counts drops so the broker can emit honest `gap` frames — events are never
 *   silently lost.
 *
 * Pure and synchronous: no I/O, no timers. The broker owns sockets and files.
 */

import {
  LOG_EVENT_VERSION,
  type GapReason,
  type IncomingLogEvent,
  type LogEvent
} from './contracts'

export const DEFAULT_RING_CAPACITY = 5000

export interface DrainedGap {
  dropped: number
  reason: GapReason
  /** Lowest `seq` still retained after the drops. */
  sinceSeq: number
}

export class LogRingBuffer {
  private readonly capacity: number
  private readonly buf: LogEvent[] = []
  private nextSeq = 1
  private droppedSinceDrain = 0

  constructor(capacity: number = DEFAULT_RING_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  /** Stamp `seq` + version, store, drop-oldest on overflow. Returns the event. */
  push(incoming: IncomingLogEvent): LogEvent {
    const event: LogEvent = {
      ...incoming,
      v: LOG_EVENT_VERSION,
      seq: this.nextSeq++
    }
    this.buf.push(event)
    if (this.buf.length > this.capacity) {
      this.buf.shift()
      this.droppedSinceDrain++
    }
    return event
  }

  get size(): number {
    return this.buf.length
  }

  /** Lowest `seq` currently retained — feeds ReadyFrame.bufferedFrom. */
  get bufferedFrom(): number {
    return this.buf.length ? this.buf[0].seq : this.nextSeq
  }

  /** The next `seq` that will be assigned. */
  get nextSequence(): number {
    return this.nextSeq
  }

  /** All retained events, oldest first (for consumer replay). */
  snapshot(): LogEvent[] {
    return this.buf.slice()
  }

  /** Retained events with `seq` strictly greater than `seq` (for resume). */
  since(seq: number): LogEvent[] {
    if (!Number.isFinite(seq)) return this.snapshot()
    return this.buf.filter((e) => e.seq > seq)
  }

  /**
   * Return and reset the drop count accumulated since the last call, or null
   * if nothing was dropped. The broker turns this into a `gap` frame.
   */
  drainDropped(): DrainedGap | null {
    if (this.droppedSinceDrain === 0) return null
    const dropped = this.droppedSinceDrain
    this.droppedSinceDrain = 0
    return {dropped, reason: 'ring_overflow', sinceSeq: this.bufferedFrom}
  }
}
