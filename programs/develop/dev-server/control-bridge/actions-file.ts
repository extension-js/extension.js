// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {BridgeTarget, CommandOp} from './contracts'

export const ACTION_RECORD_VERSION = 1 as const

export interface ActionRecord {
  v: typeof ACTION_RECORD_VERSION
  ts: string
  cmdId: string
  op: CommandOp
  target: BridgeTarget
  ok: boolean
  durationMs?: number
  principal: string
  exprHash?: string
  expr?: string
  errorName?: string
}

export interface ActionsSink {
  write(record: ActionRecord): void
}

export interface ActionsFileOptions {
  filePath: string
  maxBytes?: number
  maxLines?: number
  generations?: number
}

const DEFAULTS = {
  maxBytes: 8 * 1024 * 1024,
  maxLines: 50_000,
  generations: 3
}

export class ActionsFileWriter implements ActionsSink {
  private readonly opts: Required<ActionsFileOptions>
  private bytes = 0
  private lines = 0
  private started = false

  constructor(options: ActionsFileOptions) {
    this.opts = {...DEFAULTS, ...options}
  }

  /** Rotate any prior file so a new run starts clean. No header is written. */
  start(): void {
    if (this.started) return

    this.started = true

    try {
      fs.mkdirSync(path.dirname(this.opts.filePath), {recursive: true})
      if (fs.existsSync(this.opts.filePath)) this.rotate()
    } catch {
      // best-effort
    }

    this.bytes = 0
    this.lines = 0
  }

  write(record: ActionRecord): void {
    if (!this.started) this.start()

    const line = JSON.stringify(record) + '\n'

    try {
      fs.appendFileSync(this.opts.filePath, line, 'utf-8')
      this.bytes += Buffer.byteLength(line)
      this.lines += 1
    } catch {
      // Disk write failed; drop rather than blocking the broker.
      return
    }

    if (this.bytes >= this.opts.maxBytes || this.lines >= this.opts.maxLines) {
      this.rotate()
      this.bytes = 0
      this.lines = 0
    }
  }

  close(): void {
    this.started = false
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

export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
