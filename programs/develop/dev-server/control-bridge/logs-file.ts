// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {LOG_EVENT_VERSION, type LogEvent} from './contracts'

export interface LogsFileOptions {
  filePath: string
  runId: string
  maxBytes?: number
  maxLines?: number
  generations?: number
  flushIntervalMs?: number
  maxQueue?: number
}

const DEFAULTS = {
  maxBytes: 8 * 1024 * 1024,
  maxLines: 50_000,
  generations: 3,
  flushIntervalMs: 250,
  maxQueue: 20_000
}

export class LogsFileWriter {
  private readonly opts: Required<LogsFileOptions>
  private queue: string[] = []
  private bytes = 0
  private lines = 0
  private droppedToDisk = 0
  private timer: NodeJS.Timeout | null = null
  private started = false

  constructor(options: LogsFileOptions) {
    this.opts = {...DEFAULTS, ...options}
  }

  start(): void {
    if (this.started) return

    this.started = true

    try {
      fs.mkdirSync(path.dirname(this.opts.filePath), {recursive: true})
      if (fs.existsSync(this.opts.filePath)) this.rotate()
    } catch {
      // best-effort
    }

    this.writeHeader(null)
    this.timer = setInterval(() => this.flush(), this.opts.flushIntervalMs)

    // Don't keep the event loop alive for logging alone.
    if (this.timer.unref) this.timer.unref()
  }

  write(event: LogEvent): void {
    this.enqueue(JSON.stringify(event))
  }

  private enqueue(line: string): void {
    this.queue.push(line)

    if (this.queue.length > this.opts.maxQueue) {
      this.queue.shift()
      this.droppedToDisk++
    }
  }

  flush(): void {
    if (!this.started || this.queue.length === 0) {
      this.maybeNoteDrops()
      return
    }

    const batch = this.queue
    this.queue = []
    const payload = batch.join('\n') + '\n'

    try {
      fs.appendFileSync(this.opts.filePath, payload, 'utf-8')
      this.bytes += Buffer.byteLength(payload)
      this.lines += batch.length
    } catch {
      // Disk write failed; treat the batch as dropped rather than blocking.
      this.droppedToDisk += batch.length
    }

    this.maybeNoteDrops()

    if (this.bytes >= this.opts.maxBytes || this.lines >= this.opts.maxLines) {
      this.rotate()
      this.writeHeader(this.opts.runId)
    }
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flush()
    this.started = false
  }

  private maybeNoteDrops(): void {
    if (this.droppedToDisk === 0) return

    const dropped = this.droppedToDisk
    this.droppedToDisk = 0

    try {
      const sentinel =
        JSON.stringify({
          v: LOG_EVENT_VERSION,
          type: 'gap',
          reason: 'disk_slow',
          dropped
        }) + '\n'

      fs.appendFileSync(this.opts.filePath, sentinel, 'utf-8')

      this.bytes += Buffer.byteLength(sentinel)
      this.lines += 1
    } catch {
      // give up on the sentinel too
    }
  }

  private writeHeader(rotatedFrom: string | null): void {
    const header =
      JSON.stringify({
        v: LOG_EVENT_VERSION,
        type: 'header',
        runId: this.opts.runId,
        startedAt: new Date().toISOString(),
        rotatedFrom
      }) + '\n'

    try {
      fs.writeFileSync(this.opts.filePath, header, 'utf-8')
      this.bytes = Buffer.byteLength(header)
      this.lines = 1
    } catch {
      this.bytes = 0
      this.lines = 0
    }
  }

  private rotatedName(n: number): string {
    return this.opts.filePath.replace(/\.ndjson$/, `.${n}.ndjson`)
  }

  /** Shift generations: drop the oldest, age each, move current → .1 */
  private rotate(): void {
    const {generations} = this.opts

    try {
      const oldest = this.rotatedName(generations)

      if (fs.existsSync(oldest)) fs.rmSync(oldest, {force: true})

      for (let n = generations - 1; n >= 1; n--) {
        const from = this.rotatedName(n)
        if (fs.existsSync(from)) fs.renameSync(from, this.rotatedName(n + 1))
      }

      if (fs.existsSync(this.opts.filePath)) {
        fs.renameSync(this.opts.filePath, this.rotatedName(1))
      }
    } catch {
      // best-effort
    }
  }
}
