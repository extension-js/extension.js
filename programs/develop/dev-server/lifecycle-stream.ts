// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {CODES, ENVELOPE, type Envelope} from '../lib/messaging'

// A terminating envelope cannot describe a session, so dev/start/preview emit
// one schema-1 frame per lifecycle transition, one JSON document per line.
// Machine output is opt-in: the command layer sets EXTENSION_OUTPUT to json or
// ndjson. Both stream here, because one frame cannot describe a session.

export type LifecycleCommand = 'dev' | 'start' | 'preview'

export type LifecycleStatus =
  | 'starting'
  | 'compiled'
  | 'recompiled'
  | 'compile-failed'
  | 'ready'
  | 'browser-exited'
  | 'failed'

const MAX_OUTPUT_CHARS = 2000

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

// Closed on purpose: an unknown value means pretty, so a typo can never
// silently swallow the human output a terminal user is reading.
const MACHINE_OUTPUT_VALUES = new Set(['json', 'ndjson'])

// True when stdout belongs to a machine: frames only, human copy on stderr.
export function isMachineOutput(): boolean {
  return MACHINE_OUTPUT_VALUES.has(
    String(process.env.EXTENSION_OUTPUT || '')
      .trim()
      .toLowerCase()
  )
}

export function isLifecycleStreamEnabled(): boolean {
  return isMachineOutput()
}

// Human copy shares stdout with the frames, so it moves to stderr while the
// stream is on. The pretty path stays byte-identical to plain console.log.
export function humanLine(line: string): void {
  if (isMachineOutput()) {
    process.stderr.write(`${line}\n`)
    return
  }
  console.log(line)
}

export function stripAnsi(input: string): string {
  return String(input || '').replace(ANSI_PATTERN, '')
}

function readReadyContract(readyPath?: string): Record<string, unknown> | null {
  if (!readyPath) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// The profile-lock stamp is owned by the launcher and may be absent; every
// read is optional and falls back to the generic launch failure code.
function isProfileLocked(ready: Record<string, unknown> | null): boolean {
  if (!ready) return false
  const code = String(ready.code ?? '')
    .trim()
    .toLowerCase()
  if (code === 'profile_locked' || code === 'profile-locked') return true
  if (ready.profileLocked === true) return true
  const message = String(ready.message ?? '')
  return /profile\s+is\s+locked|singletonlock/i.test(message)
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export interface LifecycleStreamOptions {
  command: LifecycleCommand
  browser: string
  distPath: string
  readyPath?: string
  eventsPath?: string
  // Spec seam: every frame goes through one writer.
  write?: (line: string) => void
}

export class LifecycleStream {
  private readonly options: LifecycleStreamOptions
  private readonly writeLine: (line: string) => void
  private successfulCompiles = 0
  private compileAttempts = 0
  private readyEmitted = false
  private readyErrorEmitted = false
  private browserExitEmitted = false
  private boundPort: number | null = null
  private exitWatcher: NodeJS.Timeout | undefined

  constructor(options: LifecycleStreamOptions) {
    this.options = options
    this.writeLine =
      options.write || ((line: string) => process.stdout.write(line))
  }

  public get enabled(): boolean {
    return isLifecycleStreamEnabled()
  }

  private emit(frame: Envelope<unknown>): Envelope<unknown> | null {
    if (!this.enabled) return null
    this.writeLine(`${JSON.stringify(frame)}\n`)
    return frame
  }

  private sessionValue(extra: Record<string, unknown> = {}) {
    const ready = readReadyContract(this.options.readyPath)
    const port = toFiniteNumber(ready?.port) ?? this.boundPort
    return {
      command: this.options.command,
      browser: this.options.browser,
      distPath: this.options.distPath,
      pid: process.pid,
      port,
      ...(this.options.readyPath ? {readyPath: this.options.readyPath} : {}),
      ...(this.options.eventsPath ? {eventsPath: this.options.eventsPath} : {}),
      ...(typeof ready?.runId === 'string' ? {runId: ready.runId} : {}),
      ...(typeof ready?.instanceId === 'string'
        ? {instanceId: ready.instanceId}
        : {}),
      ...(typeof ready?.toolchainVersion === 'string'
        ? {toolchainVersion: ready.toolchainVersion}
        : {}),
      ...extra
    }
  }

  public starting(args: {
    requestedPort?: number | null
    port?: number | null
  }): Envelope<unknown> | null {
    this.boundPort = toFiniteNumber(args.port)
    return this.emit(
      ENVELOPE.ok(
        this.options.command,
        'starting',
        this.sessionValue({
          requestedPort: toFiniteNumber(args.requestedPort),
          port: toFiniteNumber(args.port)
        })
      )
    )
  }

  // The first successful compile is 'compiled'; every later one is 'recompiled'.
  public compiled(args: {
    assets?: number
    durationMs?: number
  }): Envelope<unknown> | null {
    this.compileAttempts += 1
    this.successfulCompiles += 1
    const status: LifecycleStatus =
      this.successfulCompiles === 1 ? 'compiled' : 'recompiled'
    return this.emit(
      ENVELOPE.ok(
        this.options.command,
        status,
        this.sessionValue({
          assets: toFiniteNumber(args.assets) ?? 0,
          durationMs: toFiniteNumber(args.durationMs) ?? 0
        })
      )
    )
  }

  public compileFailed(args: {
    output?: string
    durationMs?: number
    message?: string
  }): Envelope<unknown> | null {
    this.compileAttempts += 1
    const isFirst = this.compileAttempts === 1
    const code = isFirst ? CODES.E_FIRST_COMPILE : CODES.E_COMPILE
    const raw = stripAnsi(String(args.output || ''))
    const truncated = raw.length > MAX_OUTPUT_CHARS
    const output = truncated ? `${raw.slice(0, MAX_OUTPUT_CHARS)}…` : raw
    const message =
      args.message ||
      (isFirst
        ? 'The first compilation failed.'
        : 'A recompilation failed after a change.')
    const frame = ENVELOPE.fail(
      this.options.command,
      'compile-failed',
      {code, message},
      {truncated}
    ) as Envelope<unknown>
    // value carries the compiler output so a consumer never has to scrape stdout.
    frame.value = this.sessionValue({
      output,
      durationMs: toFiniteNumber(args.durationMs) ?? 0
    })
    return this.emit(frame)
  }

  // Emitted once, when the ready contract is on disk for this session.
  // The contract is the source of truth: a compile can succeed while the
  // browser refuses the guest, and ready.json says so by staying in error.
  public ready(args: {port?: number | null} = {}): Envelope<unknown> | null {
    if (this.readyEmitted) return null
    if (args.port != null) this.boundPort = toFiniteNumber(args.port)
    const ready = readReadyContract(this.options.readyPath)
    if (ready && ready.status === 'error') {
      if (this.readyErrorEmitted) return null
      this.readyErrorEmitted = true
      const frame = ENVELOPE.fail(this.options.command, 'failed', {
        code: CODES.E_READY_ERROR_STATUS,
        message:
          String(ready.message || '') ||
          'The ready contract reports an error for this session.'
      }) as Envelope<unknown>
      frame.value = this.sessionValue({
        ...(typeof ready.code === 'string' ? {readyCode: ready.code} : {})
      })
      return this.emit(frame)
    }
    this.readyEmitted = true
    return this.emit(
      ENVELOPE.ok(this.options.command, 'ready', this.sessionValue())
    )
  }

  public browserExited(
    args: {exitCode?: number | null; message?: string} = {}
  ): Envelope<unknown> | null {
    if (this.browserExitEmitted) return null
    this.browserExitEmitted = true
    const ready = readReadyContract(this.options.readyPath)
    const locked = isProfileLocked(ready)
    const code = locked ? CODES.E_PROFILE_LOCKED : CODES.E_BROWSER_LAUNCH
    const message =
      args.message ||
      String(ready?.message || '') ||
      (locked
        ? 'The browser profile is locked by another session.'
        : 'The browser exited before the session ended.')
    const frame = ENVELOPE.fail(this.options.command, 'browser-exited', {
      code,
      message
    }) as Envelope<unknown>
    frame.value = this.sessionValue({
      exitCode:
        toFiniteNumber(args.exitCode) ?? toFiniteNumber(ready?.browserExitCode),
      ...(typeof ready?.browserExitedAt === 'string'
        ? {browserExitedAt: ready.browserExitedAt}
        : {})
    })
    return this.emit(frame)
  }

  // The dev server never bound: a session-level failure, not a compile one.
  public failed(message: string): Envelope<unknown> | null {
    const frame = ENVELOPE.fail(this.options.command, 'failed', {
      code: CODES.E_INTERNAL,
      message: stripAnsi(message)
    }) as Envelope<unknown>
    frame.value = this.sessionValue()
    return this.emit(frame)
  }

  // Poll the ready contract for the launcher's exit stamp. Only runs while the
  // stream is on, and unref'd so it can never hold the process open.
  public watchBrowserExit(intervalMs = 1000): () => void {
    const stop = () => {
      if (this.exitWatcher) clearInterval(this.exitWatcher)
      this.exitWatcher = undefined
    }
    if (!this.enabled || !this.options.readyPath) return stop
    if (this.exitWatcher) return stop
    this.exitWatcher = setInterval(() => {
      const ready = readReadyContract(this.options.readyPath)
      if (typeof ready?.browserExitedAt !== 'string') return
      this.browserExited()
      stop()
    }, intervalMs)
    this.exitWatcher.unref?.()
    return stop
  }
}

export function createLifecycleStream(
  options: LifecycleStreamOptions
): LifecycleStream {
  return new LifecycleStream(options)
}

interface StatsLike {
  hasErrors?: () => boolean
  toString?: (options?: unknown) => string
  compilation?: {
    startTime?: number
    endTime?: number
    getAssets?: () => unknown[]
    assets?: Record<string, unknown>
  }
}

interface CompilerLike {
  hooks?: {
    done?: {tap: (name: string, fn: (stats: StatsLike) => void) => void}
    failed?: {tap: (name: string, fn: (error: unknown) => void) => void}
  }
}

function assetCount(stats: StatsLike): number {
  const compilation = stats?.compilation
  try {
    const assets = compilation?.getAssets?.()
    if (Array.isArray(assets)) return assets.length
  } catch {
    // Ignore
  }
  return Object.keys(compilation?.assets || {}).length
}

function compileDuration(stats: StatsLike): number {
  const compilation = stats?.compilation
  const start = Number(compilation?.startTime || 0)
  const end = Number(compilation?.endTime || 0)
  const duration = end - start
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function errorText(stats: StatsLike): string {
  try {
    return String(
      stats?.toString?.({all: false, errors: true, colors: false}) || ''
    )
  } catch {
    return ''
  }
}

// The compiler is read structurally: rspack's Stats types are stricter than
// what a frame needs, and a fake compiler must stay usable in specs.
export function attachLifecycleStream(
  compiler: unknown,
  stream: LifecycleStream
): void {
  const hooks = (compiler as CompilerLike | undefined)?.hooks

  hooks?.done?.tap('extension.js:lifecycle-stream', (stats) => {
    try {
      if (stats?.hasErrors?.()) {
        stream.compileFailed({
          output: errorText(stats),
          durationMs: compileDuration(stats)
        })
        return
      }
      stream.compiled({
        assets: assetCount(stats),
        durationMs: compileDuration(stats)
      })
      // The ready contract is written by the playwright plugin's done hook,
      // which is tapped first, so it is on disk by the time this runs.
      stream.ready()
    } catch {
      // Best-effort: a frame must never break the compile loop.
    }
  })

  hooks?.failed?.tap('extension.js:lifecycle-stream', (error: unknown) => {
    try {
      stream.compileFailed({
        output:
          error instanceof Error ? error.stack || error.message : String(error),
        message: error instanceof Error ? error.message : String(error)
      })
    } catch {
      // Best-effort: a frame must never break the compile loop.
    }
  })
}
