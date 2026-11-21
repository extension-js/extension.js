// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {takeCodedWarnings} from '../lib/coded-warnings'
import {compilationDiagnostics} from '../lib/compilation-diagnostics'
import {isUsageLaunchCode} from '../lib/launch-codes'
import {
  CODES,
  cdpFaultWarningCode,
  type Diagnostic,
  ENVELOPE,
  type Envelope,
  type ErrorCode,
  isMachineOutput
} from '../lib/messaging'
import {readReadyRecord} from '../lib/ready-contract-writer'
import {stripAnsi} from '../lib/strip-ansi'
import {shouldWarnPortConflict} from './messages'
import {readyContractErrorCode} from './ready-contract-codes'

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
  | 'restart-failed'
  | 'ready'
  | 'ready-failed'
  | 'browser-exited'
  | 'load-refused'
  | 'failed'
  | 'stopped'

// A frame with one of these says the process is ending: a reader stops at
// it. Every other failure leaves the session running and the stream open.
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'usage',
  'stopped'
])

const MAX_OUTPUT_CHARS = 2000

// Machine-mode detection lives in lib/messaging.ts so every sink reads one
// signal; re-exported here for the consumers that always imported it here.
export {isMachineOutput}

export function isLifecycleStreamEnabled(): boolean {
  return isMachineOutput()
}

function readReadyContract(readyPath?: string): Record<string, unknown> | null {
  if (!readyPath) return null

  return readReadyRecord(readyPath) ?? null
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

// The launcher stamps the code it refused with beside the generic id, and a
// code the table declares outranks the contract's own status code.
function stampedLaunchFailureCode(
  ready: Record<string, unknown>
): ErrorCode | undefined {
  if (ready.code !== 'browser_launch_failed') return undefined

  const code = ready.browserLaunchFailedCode

  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(CODES, code)
    ? (code as ErrorCode)
    : undefined
}

// The launcher keeps a session whose CDP wire failed alive and ready and names
// the fault on the contract, so the ready frame carries it as a coded warning.
function cdpFaultWarnings(ready: Record<string, unknown> | null): string[] {
  const stamped = ready?.cdpFaultCode
  if (typeof stamped !== 'string' || !stamped.trim()) return []

  // An older launcher stamped the E_ name, and a warning never carries one.
  const code = cdpFaultWarningCode(stamped.trim())

  const message =
    typeof ready?.cdpFaultMessage === 'string' && ready.cdpFaultMessage.trim()
      ? ready.cdpFaultMessage.trim()
      : 'the CDP wire failed after launch'

  return [`${code}: ${message}`]
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
  noBrowser?: boolean
  // The host's hint for a code, for a terminal failure that carries none.
  hintFor?: (code: ErrorCode) => string | undefined
  // Ends the session once a launch refused over a value the user set is
  // framed as usage. Without it the refusal reads as a survivable one.
  onUsageRefusal?: (
    code: ErrorCode,
    message: string,
    ready: Record<string, unknown>
  ) => void
  // Spec seam: every frame goes through one writer.
  write?: (line: string) => void
}

export class LifecycleStream {
  private readonly options: LifecycleStreamOptions
  private readonly writeLine: (line: string) => void
  private successfulCompiles = 0
  private compileAttempts = 0
  private readyEmitted = false
  // The contract error the ready report last wrote a frame for.
  private reportedReadyError: string | null = null
  private browserExitEmitted = false
  private interruptEmitted = false
  private terminalEmitted = false
  private terminalWritten = false
  private startingEmitted = false
  private boundPort: number | null = null
  private exitWatcher: NodeJS.Timeout | undefined
  private launchFailureWatcher: NodeJS.Timeout | undefined

  constructor(options: LifecycleStreamOptions) {
    this.options = options
    this.writeLine =
      options.write || ((line: string) => process.stdout.write(line))
  }

  public get enabled(): boolean {
    return isLifecycleStreamEnabled()
  }

  // True once the terminal frame is on the stream, so a host adds no other.
  public get ended(): boolean {
    return this.terminalWritten
  }

  // One terminal frame per stream and nothing after it, whichever of a
  // signal, an exit or a late compile comes second.
  private emit(frame: Envelope<unknown>): Envelope<unknown> | null {
    if (this.terminalEmitted) return null

    const terminal = TERMINAL_STATUSES.has(frame.status)

    if (!this.enabled) {
      if (terminal) this.terminalEmitted = true

      return null
    }

    if (frame.status === 'failed' || frame.status === 'usage') {
      this.addHostHint(frame)
    }

    // A closed pipe must not replace the failure this frame reports, and a
    // write that threw leaves the terminal frame to the next one that tries.
    try {
      this.writeLine(`${JSON.stringify(frame)}\n`)
    } catch {
      return null
    }

    if (terminal) {
      this.terminalEmitted = true
      this.terminalWritten = true
    }

    return frame
  }

  // A resolver that throws costs the frame its hint and nothing else.
  private hostHint(code: string | undefined): string | undefined {
    if (!code || !this.options.hintFor) return undefined

    try {
      const hint = this.options.hintFor(code as ErrorCode)

      return typeof hint === 'string' && hint ? hint : undefined
    } catch {
      return undefined
    }
  }

  private addHostHint(frame: Envelope<unknown>): void {
    if (frame.hint) return

    const hint = this.hostHint(frame.error?.code)
    if (hint) frame.hint = hint
  }

  // A frame that ends nothing says the session goes on, and the host's
  // remedy for its code, when there is one, comes first.
  private withHostRemedy(code: string, sessionLine: string): string {
    const remedy = this.hostHint(code)

    return remedy ? `${remedy} ${sessionLine}` : sessionLine
  }

  public sessionValue(
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
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
    const requestedPort = toFiniteNumber(args.requestedPort)
    const port = toFiniteNumber(args.port)
    this.boundPort = port
    const reassigned =
      port !== null && shouldWarnPortConflict(requestedPort, port)
    this.startingEmitted = true
    const warnings = reassigned
      ? [
          `${CODES.W_PORT_IN_USE}: port ${requestedPort} was taken, ` +
            `so the dev server listens on port ${port}`
        ]
      : []
    // What the setup steps before the server warned about rides the first frame.
    warnings.push(...takeCodedWarnings())

    return this.emit(
      ENVELOPE.ok(
        this.options.command,
        'starting',
        this.sessionValue({requestedPort, port}),
        {warnings}
      )
    )
  }

  // The first successful compile is 'compiled'; every later one is 'recompiled'.
  public compiled(args: {
    assets?: number
    durationMs?: number
    entrypoints?: number
  }): Envelope<unknown> | null {
    this.compileAttempts += 1
    this.successfulCompiles += 1
    const status: LifecycleStatus =
      this.successfulCompiles === 1 ? 'compiled' : 'recompiled'
    const assets = toFiniteNumber(args.assets) ?? 0
    // Green by the bundler's count and empty by every other, so the frame says so.
    const warnings =
      assets === 0 && toFiniteNumber(args.entrypoints) === 0
        ? [
            `${CODES.W_NO_ENTRYPOINTS}: the compilation produced no entrypoints or assets`
          ]
        : []

    return this.emit(
      ENVELOPE.ok(
        this.options.command,
        status,
        this.sessionValue({
          assets,
          durationMs: toFiniteNumber(args.durationMs) ?? 0
        }),
        {warnings}
      )
    )
  }

  public compileFailed(args: {
    output?: string
    durationMs?: number
    message?: string
    diagnostics?: Diagnostic[]
    diagnosticsTruncated?: boolean
  }): Envelope<unknown> | null {
    this.compileAttempts += 1
    const isFirst = this.compileAttempts === 1
    const code = isFirst ? CODES.E_FIRST_COMPILE : CODES.E_COMPILE
    const raw = stripAnsi(String(args.output || ''))
    const outputTruncated = raw.length > MAX_OUTPUT_CHARS
    const output = outputTruncated ? `${raw.slice(0, MAX_OUTPUT_CHARS)}…` : raw
    const message =
      args.message ||
      (isFirst
        ? 'The first compilation failed.'
        : 'A recompilation failed after a change.')
    const details =
      Array.isArray(args.diagnostics) && args.diagnostics.length > 0
        ? args.diagnostics
        : undefined
    // The launcher holds the browser back until a compile succeeds, which a
    // reader of the stream would otherwise learn from the human line only.
    const launchWithheld =
      this.successfulCompiles === 0 && !this.options.noBrowser
    const frame = ENVELOPE.fail(
      this.options.command,
      'compile-failed',
      {code, message, ...(details ? {details} : {})},
      {
        truncated: outputTruncated || args.diagnosticsTruncated === true,
        warnings: launchWithheld
          ? [
              `${CODES.W_LAUNCH_SKIPPED_COMPILE_ERRORS}: the browser launch is withheld until the compile succeeds`
            ]
          : []
      }
    ) as Envelope<unknown>
    // value carries the compiler output so a consumer never has to scrape stdout.
    frame.value = this.sessionValue({
      output,
      durationMs: toFiniteNumber(args.durationMs) ?? 0
    })

    return this.emit(frame)
  }

  // Written once the contract is on disk, again after an error survived, and
  // again for the server a restart built. The contract decides, since a
  // compile can pass while the browser refuses.
  public ready(
    args: {port?: number | null; restarted?: boolean} = {}
  ): Envelope<unknown> | null {
    if (args.port != null) this.boundPort = toFiniteNumber(args.port)
    if (args.restarted) this.readyEmitted = false

    const ready = readReadyContract(this.options.readyPath)

    if (ready && ready.status === 'error') {
      // A browser that exited reads the same here as from the exit watcher.
      if (ready.code === 'browser_exited') return this.browserExited()

      // One frame per verdict, however many compiles find it still there, and
      // one per launch the next compiles try and fail again.
      const verdict = `${String(ready.code ?? '')} ${String(ready.browserLaunchFailedAt ?? '')}`
      if (this.reportedReadyError === verdict) return null

      this.reportedReadyError = verdict
      this.readyEmitted = false

      // No compile changes a bad pin or a refused profile mode, so the
      // session ends on the usage frame instead of serving with no browser.
      const launchCode = stampedLaunchFailureCode(ready)
      const onUsageRefusal = this.options.onUsageRefusal

      if (launchCode && isUsageLaunchCode(launchCode) && onUsageRefusal) {
        const frame = this.contractError(ready, false)

        try {
          onUsageRefusal(launchCode, String(ready.message || launchCode), ready)
        } catch {
          // The usage frame is out, and the exit hook still ends the run.
        }

        return frame
      }

      return this.contractError(ready, true)
    }

    if (this.readyEmitted) return null

    this.readyEmitted = true
    this.reportedReadyError = null

    return this.emit(
      ENVELOPE.ok(
        this.options.command,
        'ready',
        this.sessionValue(args.restarted ? {restarted: true} : {}),
        {warnings: cdpFaultWarnings(ready)}
      )
    )
  }

  // A bad pin or a profile the browser cannot load into is a value the user
  // set, the status every other command gives it.
  private contractError(
    ready: Record<string, unknown>,
    sessionGoesOn: boolean,
    exitCode?: ErrorCode
  ): Envelope<unknown> | null {
    const launchCode = stampedLaunchFailureCode(ready)
    const loadRefused = ready.code === 'extension_load_refused'
    const launchFailed = ready.code === 'browser_launch_failed'
    // Read while the session runs, every error is retried by the next compile:
    // the launch, the load, or the build. Only the exit makes one terminal.
    const survivable = sessionGoesOn
    const status = survivable
      ? loadRefused
        ? 'load-refused'
        : 'ready-failed'
      : isUsageLaunchCode(launchCode)
        ? 'usage'
        : 'failed'
    const code = loadRefused
      ? CODES.E_EXTENSION_LOAD_REFUSED
      : (launchCode ??
        exitCode ??
        readyContractErrorCode(ready.code) ??
        CODES.E_READY_ERROR_STATUS)
    const sessionLine = survivable
      ? loadRefused
        ? 'The session keeps running. Fix what the browser names and save: the next compile offers the extension again.'
        : launchFailed
          ? 'The session keeps running with no browser. Fix what the launch names and save: the next compile tries the launch again.'
          : 'The session keeps running. A later compile that clears the error writes the ready frame.'
      : loadRefused
        ? 'Fix what the browser names, then run the command again.'
        : undefined
    const hint =
      survivable && sessionLine
        ? this.withHostRemedy(code, sessionLine)
        : sessionLine
    const frame = ENVELOPE.fail(
      this.options.command,
      status,
      {
        // The id resolves through the table --wait reads, one code per state.
        code,
        message:
          String(ready.message || '') ||
          'The ready contract reports an error for this session.'
      },
      hint ? {hint} : {}
    ) as Envelope<unknown>
    frame.value = this.sessionValue({
      ...(typeof ready.code === 'string' ? {readyCode: ready.code} : {})
    })

    return this.emit(frame)
  }

  // The launcher ends the process from inside the compile hook it owns, so
  // the stream never sees that compile end: the exit is the last chance to
  // name the failure the contract already carries. Before the starting frame
  // the command layer still owns the failure and prints its own.
  public exited(exitCode: number): Envelope<unknown> | null {
    if (!this.startingEmitted || this.terminalEmitted) return null

    // A session that ended on its own with nothing wrong still says it ended.
    if (exitCode === 0) {
      return this.emit(
        ENVELOPE.ok(
          this.options.command,
          'stopped',
          this.sessionValue({exitCode})
        )
      )
    }

    const ready = readReadyContract(this.options.readyPath)

    // The process is ending, so whatever the contract carries is the one
    // terminal frame, a browser exit or a refused load included.
    if (ready && ready.status === 'error') {
      return this.contractError(
        ready,
        false,
        ready.code === 'browser_exited'
          ? this.browserExitCode(ready)
          : undefined
      )
    }

    const frame = ENVELOPE.fail(this.options.command, 'failed', {
      code: CODES.E_INTERNAL,
      message: `The dev session ended with exit code ${exitCode}.`
    }) as Envelope<unknown>
    frame.value = this.sessionValue({exitCode})

    return this.emit(frame)
  }

  // A stop that passed its bound ends the process from a timer, and the exit
  // alone could not tell that from a crash.
  public shutdownTimedOut(
    timeoutMs: number,
    exitCode: number
  ): Envelope<unknown> | null {
    if (!this.startingEmitted) return null

    const frame = ENVELOPE.fail(this.options.command, 'failed', {
      code: CODES.E_SHUTDOWN_TIMEOUT,
      message: `The ${this.options.command} session did not stop within ${timeoutMs} ms, so the process exits with code ${exitCode}.`
    }) as Envelope<unknown>
    frame.value = this.sessionValue({exitCode, shutdownTimeoutMs: timeoutMs})

    return this.emit(frame)
  }

  public emitOnExit(): () => void {
    const onExit = (code: number) => {
      try {
        this.exited(code)
      } catch {
        // Best-effort: the exit code is the verdict that must survive.
      }
    }

    process.once('exit', onExit)

    return () => {
      process.removeListener('exit', onExit)
    }
  }

  // This frame shipped coded E_BROWSER_LAUNCH and consumers key on it, so
  // it stays, though --wait names the same contract state E_BROWSER_EXITED.
  private browserExitCode(ready: Record<string, unknown> | null): ErrorCode {
    return isProfileLocked(ready)
      ? CODES.E_PROFILE_LOCKED
      : CODES.E_BROWSER_LAUNCH
  }

  public browserExited(
    args: {exitCode?: number | null; message?: string} = {}
  ): Envelope<unknown> | null {
    if (this.browserExitEmitted) return null

    this.browserExitEmitted = true
    const ready = readReadyContract(this.options.readyPath)
    const locked = isProfileLocked(ready)
    const code = this.browserExitCode(ready)
    const message =
      args.message ||
      String(ready?.message || '') ||
      (locked
        ? 'The browser profile is locked by another session.'
        : 'The browser exited before the session ended.')
    // The dev server outlives its browser, so this frame ends nothing.
    const frame = ENVELOPE.fail(
      this.options.command,
      'browser-exited',
      {code, message},
      {
        hint: this.withHostRemedy(
          code,
          'The dev server keeps running with no browser. Stop it, then run the command again to launch one.'
        )
      }
    ) as Envelope<unknown>
    frame.value = this.sessionValue({
      exitCode:
        toFiniteNumber(args.exitCode) ?? toFiniteNumber(ready?.browserExitCode),
      ...(typeof ready?.browserExitSignal === 'string'
        ? {exitSignal: ready.browserExitSignal}
        : {}),
      ...(typeof ready?.browserExitedAt === 'string'
        ? {browserExitedAt: ready.browserExitedAt}
        : {}),
      ...(typeof ready?.code === 'string' ? {readyCode: ready.code} : {})
    })

    return this.emit(frame)
  }

  // The session was told to stop. The run did not fail, but a stream that
  // just ends leaves a reader guessing, so the last frame says why it ended.
  public interrupted(signal: string): Envelope<unknown> | null {
    if (this.interruptEmitted) return null

    this.interruptEmitted = true
    const frame = ENVELOPE.fail(this.options.command, 'stopped', {
      code: CODES.E_INTERRUPTED,
      message: `The ${this.options.command} session was interrupted by ${signal}.`
    }) as Envelope<unknown>
    frame.value = this.sessionValue({signal})

    return this.emit(frame)
  }

  // The session cannot go on: the dev server never bound, unless the caller
  // names another reason. A session-level failure, not a compile one.
  public failed(
    message: string,
    code: ErrorCode = CODES.E_DEV_SERVER_START
  ): Envelope<unknown> | null {
    const frame = ENVELOPE.fail(this.options.command, 'failed', {
      code,
      message: stripAnsi(message)
    }) as Envelope<unknown>
    frame.value = this.sessionValue()

    return this.emit(frame)
  }

  // The next compiler could not be built and the session goes on with the
  // build it had, so this frame ends nothing.
  public restartFailed(args: {
    code: ErrorCode
    message: string
  }): Envelope<unknown> | null {
    const frame = ENVELOPE.fail(
      this.options.command,
      'restart-failed',
      {code: args.code, message: stripAnsi(args.message)},
      {
        hint: 'The previous build keeps serving. Fix the error, then save a project file to retry.'
      }
    ) as Envelope<unknown>
    frame.value = this.sessionValue({serving: true})

    return this.emit(frame)
  }

  // Poll the ready contract for the launcher's exit stamp. Unref'd so it can
  // never hold the process open. Runs while the stream is on, or for as long
  // as a caller wants the stamp handed to it (the dev server tells the broker
  // and the events file), since the browser is gone either way.
  public watchBrowserExit(
    intervalMs = 1000,
    onExit?: (ready: Record<string, unknown>) => void
  ): () => void {
    const stop = () => {
      if (this.exitWatcher) clearInterval(this.exitWatcher)

      this.exitWatcher = undefined
    }

    if (!this.options.readyPath) return stop
    if (!this.enabled && !onExit) return stop
    if (this.exitWatcher) return stop

    this.exitWatcher = setInterval(() => {
      const ready = readReadyContract(this.options.readyPath)
      if (typeof ready?.browserExitedAt !== 'string') return

      onExit?.(ready)
      this.browserExited()
      stop()
    }, intervalMs)

    this.exitWatcher.unref?.()

    return stop
  }

  // Hands each new launch-failure stamp to the caller, for the events file.
  // ready() writes the frame, and a later compile may fail its launch again.
  public watchBrowserLaunchFailure(
    intervalMs = 1000,
    onFailure: (ready: Record<string, unknown>) => void
  ): () => void {
    const stop = () => {
      if (this.launchFailureWatcher) clearInterval(this.launchFailureWatcher)

      this.launchFailureWatcher = undefined
    }

    if (!this.options.readyPath) return stop
    if (this.launchFailureWatcher) return stop

    let lastStamp: string | null = null

    this.launchFailureWatcher = setInterval(() => {
      const ready = readReadyContract(this.options.readyPath)
      const stamp = ready?.browserLaunchFailedAt
      if (!ready || typeof stamp !== 'string' || stamp === lastStamp) return

      lastStamp = stamp
      onFailure(ready)
    }, intervalMs)

    this.launchFailureWatcher.unref?.()

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
  toJson?: (options?: unknown) => {entrypoints?: Record<string, unknown>}
  compilation?: {
    startTime?: number
    endTime?: number
    getAssets?: () => unknown[]
    assets?: Record<string, unknown>
    errors?: unknown[]
    warnings?: unknown[]
    compiler?: {context?: string}
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

function entrypointCount(stats: StatsLike): number | undefined {
  try {
    const entrypoints = stats?.toJson?.({
      all: false,
      entrypoints: true
    })?.entrypoints

    return entrypoints && typeof entrypoints === 'object'
      ? Object.keys(entrypoints).length
      : undefined
  } catch {
    return undefined
  }
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
  stream: LifecycleStream,
  options: {restart?: boolean} = {}
): void {
  const hooks = (compiler as CompilerLike | undefined)?.hooks
  // A restart serves from a new server, which ready.json reports as starting
  // until this compiler's first green build, so the stream says ready again.
  let restartReadyOwed = options.restart === true

  hooks?.done?.tap('extension.js:lifecycle-stream', (stats) => {
    try {
      if (stats?.hasErrors?.()) {
        const {details, truncated} = compilationDiagnostics(stats.compilation)
        stream.compileFailed({
          output: errorText(stats),
          durationMs: compileDuration(stats),
          diagnostics: details,
          diagnosticsTruncated: truncated
        })

        return
      }

      stream.compiled({
        assets: assetCount(stats),
        durationMs: compileDuration(stats),
        entrypoints: entrypointCount(stats)
      })

      // The ready contract is written by the ready contract plugin's done hook,
      // which is tapped first, so it is on disk by the time this runs.
      stream.ready({restarted: restartReadyOwed})
      restartReadyOwed = false
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
