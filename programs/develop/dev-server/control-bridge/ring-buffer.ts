// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  type GapReason,
  type IncomingLogEvent,
  LOG_EVENT_VERSION,
  type LogEvent
} from './contracts'

export const DEFAULT_RING_CAPACITY = 5000

export interface DrainedGap {
  dropped: number
  reason: GapReason
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

  get bufferedFrom(): number {
    return this.buf.length ? this.buf[0].seq : this.nextSeq
  }

  get nextSequence(): number {
    return this.nextSeq
  }

  snapshot(): LogEvent[] {
    return this.buf.slice()
  }

  since(seq: number): LogEvent[] {
    if (!Number.isFinite(seq)) return this.snapshot()
    return this.buf.filter((e) => e.seq > seq)
  }

  drainDropped(): DrainedGap | null {
    if (this.droppedSinceDrain === 0) return null

    const dropped = this.droppedSinceDrain
    this.droppedSinceDrain = 0

    return {dropped, reason: 'ring_overflow', sinceSeq: this.bufferedFrom}
  }
}
