// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {renameSyncWithRetry} from '../../lib/rename-with-retry'
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

const HEADER_PROBE_BYTES = 1024

function closeQuietly(fd: number | undefined): void {
  if (fd === undefined) return

  try {
    fs.closeSync(fd)
  } catch {
    // Ignore
  }
}

// Reads the header through an open descriptor, so the answer is about the
// file that descriptor holds and not about whatever the path names by now.
export function readLogDescriptorRunId(fd: number): string | undefined {
  try {
    const buffer = Buffer.alloc(HEADER_PROBE_BYTES)
    const read = fs.readSync(fd, buffer, 0, HEADER_PROBE_BYTES, 0)
    const firstLine = buffer.toString('utf-8', 0, read).split(/\r?\n/)[0]
    const header = JSON.parse(firstLine)

    return header?.type === 'header' && typeof header.runId === 'string'
      ? header.runId
      : undefined
  } catch {
    return undefined
  }
}

// The run id in the header a session wrote when it took the file.
export function readLogFileRunId(filePath: string): string | undefined {
  let fd: number | undefined

  try {
    fd = fs.openSync(filePath, 'r')

    return readLogDescriptorRunId(fd)
  } catch {
    return undefined
  } finally {
    closeQuietly(fd)
  }
}

function isForeignRunId(owner: string | undefined, runId: string): boolean {
  return owner !== undefined && owner !== '' && owner !== runId
}

// A session that exits late must not append to the file a newer run took,
// the same rule ready.json writes follow.
export function isLogFileOwnedByAnotherRun(
  filePath: string,
  runId: string
): boolean {
  return isForeignRunId(readLogFileRunId(filePath), runId)
}

export type OwnedAppendResult = 'written' | 'foreign' | 'failed'

// One descriptor carries the ownership check and the append. A newer run that
// renames the file away in between leaves these rows in the renamed file.
export function appendToOwnedLogFile(
  filePath: string,
  runId: string,
  payload: string
): OwnedAppendResult {
  let fd: number | undefined

  try {
    fd = fs.openSync(filePath, 'a+')

    if (isForeignRunId(readLogDescriptorRunId(fd), runId)) return 'foreign'

    fs.appendFileSync(fd, payload, 'utf-8')

    return 'written'
  } catch {
    return 'failed'
  } finally {
    closeQuietly(fd)
  }
}

// A new file takes the path by rename, so a descriptor an older run still
// holds keeps naming the old file. Truncating in place would hand it this one.
export function replaceLogFile(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.tmp`

  try {
    fs.writeFileSync(tempPath, content, 'utf-8')
    renameSyncWithRetry(tempPath, filePath)
  } catch {
    // Windows can refuse a rename onto a file a reader holds open.
    fs.rmSync(tempPath, {force: true})
    fs.writeFileSync(filePath, content, 'utf-8')
  }
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
      // Ignore
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

    const payload = `${batch.join('\n')}\n`
    const result = appendToOwnedLogFile(
      this.opts.filePath,
      this.opts.runId,
      payload
    )

    // Another run owns the file now, so these rows have no place in it.
    if (result === 'foreign') {
      this.droppedToDisk = 0

      return
    }

    if (result === 'written') {
      this.bytes += Buffer.byteLength(payload)
      this.lines += batch.length
    } else {
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

    const sentinel = `${JSON.stringify({
      v: LOG_EVENT_VERSION,
      type: 'gap',
      reason: 'disk_slow',
      dropped
    })}\n`
    const result = appendToOwnedLogFile(
      this.opts.filePath,
      this.opts.runId,
      sentinel
    )

    if (result !== 'written') return

    this.bytes += Buffer.byteLength(sentinel)
    this.lines += 1
  }

  private writeHeader(rotatedFrom: string | null): void {
    const header = `${JSON.stringify({
      v: LOG_EVENT_VERSION,
      type: 'header',
      runId: this.opts.runId,
      startedAt: new Date().toISOString(),
      rotatedFrom
    })}\n`

    try {
      replaceLogFile(this.opts.filePath, header)
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

  private rotate(): void {
    const {generations} = this.opts

    try {
      const oldest = this.rotatedName(generations)

      if (fs.existsSync(oldest)) fs.rmSync(oldest, {force: true})

      for (let n = generations - 1; n >= 1; n--) {
        const from = this.rotatedName(n)

        if (fs.existsSync(from)) {
          renameSyncWithRetry(from, this.rotatedName(n + 1))
        }
      }

      if (fs.existsSync(this.opts.filePath)) {
        renameSyncWithRetry(this.opts.filePath, this.rotatedName(1))
      }
    } catch {
      // Ignore
    }
  }
}
