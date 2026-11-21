// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, Stats} from '@rspack/core'
import {type CodedError, codedError} from '../lib/coded-error'
import {
  CODES,
  type ErrorCode,
  humanLine,
  stripChannelPrefix
} from '../lib/messaging'
import * as messages from './messages'
import type {DevSessionRestartRequest} from './session-restart'

const DEFAULT_START_TIMEOUT_MS = 30000

// The longest delay a timer takes. A longer one fires after 1 ms instead.
export const MAX_TIMER_MS = 2147483647

// A wait in milliseconds as a setting spells it: whole digits only, so
// "1e5" and "1.5" are no value at all. Capped at what a timer holds.
export function readTimerMs(value: string | number | undefined): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : /^\d+$/.test(String(value ?? '').trim())
        ? Number(String(value).trim())
        : Number.NaN

  // Digits past what a number holds still mean a long wait, so they cap.
  return parsed > 0 ? Math.min(parsed, MAX_TIMER_MS) : null
}

// Anything but a positive whole number would arm the slow-start warning for
// the wrong moment, so it falls back to the default.
export function readStartTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return readTimerMs(env.EXTENSION_START_TIMEOUT_MS) ?? DEFAULT_START_TIMEOUT_MS
}

// For a start whose caller reports the failure itself.
export function rethrowStartFailure(error: unknown): never {
  throw error
}

interface StartBundlerOptions {
  timeoutMs: number
  onSlowStart: () => void
  onFailure: (error: unknown) => void
}

export async function startBundler(
  server: {start: () => Promise<void>},
  options: StartBundlerOptions
): Promise<void> {
  let startTimeout: NodeJS.Timeout | undefined

  try {
    startTimeout = setTimeout(options.onSlowStart, options.timeoutMs)

    await server.start()

    if (startTimeout) clearTimeout(startTimeout)
  } catch (error) {
    if (startTimeout) clearTimeout(startTimeout)

    options.onFailure(error)
  }
}

// A bind failure arrives inside the server's error event, where a throw is
// uncaught, so it is handed to whoever awaits the start instead.
export function createBindFailureRelay() {
  let failure: {error: unknown} | null = null
  let rejectPending: ((error: unknown) => void) | null = null

  return {
    report(error: unknown) {
      if (rejectPending) rejectPending(error)
      else failure = {error}
    },
    during<T>(work: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const settle = () => {
          rejectPending = null
        }

        if (failure) {
          const {error} = failure
          failure = null
          reject(error)

          return
        }

        rejectPending = (error) => {
          settle()
          reject(error)
        }

        work().then(
          (value) => {
            settle()
            resolve(value)
          },
          (error) => {
            settle()
            reject(error)
          }
        )
      })
    }
  }
}

// What a library caller's promise rejects with: the declared code, a message
// with no color or glyph, and the error the server gave as its cause.
interface DevServerStartError extends CodedError {
  cause: unknown
  // The session that failed: pid, port, paths.
  session?: Record<string, unknown>
  // True when the failed frame is already on the stream, so a caller that
  // prints frames adds none.
  framed?: boolean
}

export function devServerStartError(error: unknown): DevServerStartError {
  const raw = error instanceof Error ? error.message : String(error)
  const coded = codedError(
    CODES.E_DEV_SERVER_START,
    stripChannelPrefix(raw) || 'The dev server could not start.'
  ) as DevServerStartError
  coded.cause = error

  return coded
}

export interface StartFailureTargets {
  metadata: {
    writeError: (code: string, message: string) => void
    // Keeps the error on ready.json past the watch close of the ended session.
    writeEndedAsFailed?: (code: string, message: string) => void
    // The same failure on the events timeline, beside the compiles.
    writeRestartFailed?: (args: {
      code: string
      message: string
      serving: boolean
    }) => void
  }
  lifecycle: {
    failed: (message: string) => unknown
    sessionValue: () => Record<string, unknown>
    // True once the stream carries its terminal frame, this one or an
    // earlier one.
    readonly ended: boolean
  }
  onExitError?: (error: unknown, code?: string) => void
  print?: (line: string) => void
  exit?: (code: number) => never
  // False for a library caller: the failure is thrown and nothing exits.
  exitOnError?: boolean
}

export function createStartFailure(targets: StartFailureTargets) {
  const print = targets.print ?? humanLine
  const exit = targets.exit ?? ((code: number) => process.exit(code))
  const exitOnError = targets.exitOnError ?? true

  return (error: unknown): never => {
    targets.metadata.writeError(
      'dev_server_start_failed',
      error instanceof Error ? error.message : String(error)
    )

    targets.metadata.writeEndedAsFailed?.(
      CODES.E_DEV_SERVER_START,
      error instanceof Error ? error.message : String(error)
    )

    // The stream's one terminal frame is written here for every host.
    targets.lifecycle.failed(
      error instanceof Error ? error.message : String(error)
    )

    // The caller prints its own rejection, and reads framed to add no frame.
    if (!exitOnError) {
      const coded = devServerStartError(error)
      coded.session = targets.lifecycle.sessionValue()
      coded.framed = targets.lifecycle.ended

      throw coded
    }

    print(messages.extensionJsRunnerError(error))

    try {
      targets.onExitError?.(error, CODES.E_DEV_SERVER_START)
    } catch {
      // Best-effort: a caller's report must never change how the run ends.
    }

    return exit(1)
  }
}

// The code an error declares, when it is one the catalog knows.
export function declaredErrorCode(error: unknown): ErrorCode | undefined {
  const code = (error as {code?: unknown} | null)?.code

  return typeof code === 'string' &&
    (Object.values(CODES) as string[]).includes(code)
    ? (code as ErrorCode)
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface RestartFailureTargets {
  metadata: {
    writeError: (code: string, message: string) => void
    // Keeps the error on ready.json past the watch close of the ended session.
    writeEndedAsFailed?: (code: string, message: string) => void
    // The same failure on the events timeline, beside the compiles.
    writeRestartFailed?: (args: {
      code: string
      message: string
      serving: boolean
    }) => void
  }
  lifecycle: {
    failed: (message: string) => void
    restartFailed: (args: {code: ErrorCode; message: string}) => void
  }
  // Puts the session back on the compiler that is still serving, which asks
  // for the failed restart again on its next change.
  keepServing: (retry?: DevSessionRestartRequest) => void
  // A queued restart supersedes the serving compiler, which stays quiet.
  hasQueuedRestart: () => boolean
  // Lets go of what a session with no server still holds open.
  release: (server: {stop?: () => Promise<void>}) => Promise<void>
  onExitError?: (error: unknown, code?: string) => void
  print?: (line: string) => void
  exit?: (code: number) => void
  // False for a library caller: the session ends and nothing exits.
  exitOnError?: boolean
}

// A restart fails in one of two places. Before the old server stops, the
// session goes on with the build it had. After, nothing is left to serve.
export function createRestartFailure(targets: RestartFailureTargets) {
  const print = targets.print ?? humanLine
  const exit = targets.exit ?? ((code: number) => process.exit(code))
  const exitOnError = targets.exitOnError ?? true

  const previousBuildKeepsServing = (
    error: unknown,
    retry?: DevSessionRestartRequest
  ) => {
    if (!targets.hasQueuedRestart()) targets.keepServing(retry)

    print(messages.devServerRestartFailed(error, 'previous-build'))

    const failure = {
      code: declaredErrorCode(error) ?? CODES.E_DEV_SERVER_START,
      message: stripChannelPrefix(errorMessage(error))
    }

    targets.metadata.writeRestartFailed?.({...failure, serving: true})
    targets.lifecycle.restartFailed(failure)
  }

  return {
    bundle(error: unknown, request?: DevSessionRestartRequest): void {
      previousBuildKeepsServing(error, request)
    },
    stop(error: unknown): void {
      print(messages.devServerStopFailedOnRestart(error))
    },
    async start(
      error: unknown,
      server: {stop?: () => Promise<void>}
    ): Promise<void> {
      targets.metadata.writeError(
        'dev_server_start_failed',
        errorMessage(error)
      )

      targets.metadata.writeEndedAsFailed?.(
        CODES.E_DEV_SERVER_START,
        errorMessage(error)
      )

      targets.metadata.writeRestartFailed?.({
        code: CODES.E_DEV_SERVER_START,
        message: stripChannelPrefix(errorMessage(error)),
        serving: false
      })

      targets.lifecycle.failed(errorMessage(error))
      print(messages.devServerRestartFailed(error, 'no-server'))

      try {
        targets.onExitError?.(error, CODES.E_DEV_SERVER_START)
      } catch {
        // Best-effort: a caller's report must never change how the run ends.
      }

      if (exitOnError) {
        exit(1)

        return
      }

      await targets.release(server)
    },
    // An unexpected throw still gets its line, and a serving compiler is not
    // left restarting. The scheduler's request here says nothing of a server.
    unexpected(error: unknown, state?: object): void {
      const {previousServing, request} = (state ?? {}) as {
        previousServing?: unknown
        request?: DevSessionRestartRequest
      }

      if (previousServing === true) previousBuildKeepsServing(error, request)
      else print(messages.devServerRestartFailed(error, 'unknown'))
    }
  }
}

interface FailedStartRelease {
  server: {stop?: () => Promise<void>}
  releasePort: () => Promise<void>
  closeControlBridge: () => Promise<void>
  stopTimeoutMs?: number
}

interface EndedSessionRelease extends FailedStartRelease {
  // Everything the session registered in the host, see session-holdings.
  holdings: {beginRelease: () => void; releaseAll: () => void}
}

// A session that ended without a process exit leaves nothing registered in
// the host: no restart can start, no handler or timer waits, no file is open.
export async function releaseEndedSession(
  release: EndedSessionRelease
): Promise<void> {
  // Nothing new may start while the server stops, and the log file stays
  // open until it has, so what the teardown logs still reaches it.
  try {
    release.holdings.beginRelease()
  } catch {
    // Ignore
  }

  await releaseFailedStart(release)

  try {
    release.holdings.releaseAll()
  } catch {
    // Ignore
  }
}

// Best effort and bounded: a server that never listened may not answer stop,
// and the caller is owed its rejection either way.
export async function releaseFailedStart(
  release: FailedStartRelease
): Promise<void> {
  // Same order as a shutdown: the port is let go last, once nothing of the
  // session still listens beside it.
  const steps = [
    () => release.server.stop?.(),
    release.closeControlBridge,
    release.releasePort
  ]

  for (const step of steps) {
    let timer: NodeJS.Timeout | undefined

    try {
      await Promise.race([
        step(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, release.stopTimeoutMs ?? 2000)
          timer.unref?.()
        })
      ])
    } catch {
      // Ignore
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

// Ready is said once per session, by whoever knows it: the plugin that
// opens the browser, or the first clean compile when nothing is launched.
export function createReadyAnnouncer(onReady: (() => void) | undefined) {
  let readyAnnounced = false

  return () => {
    if (readyAnnounced) return

    readyAnnounced = true

    try {
      onReady?.()
    } catch {
      // Best-effort: a caller's announcement must never stop the session.
    }
  }
}

// A session that launches no browser has no plugin to reload it or to say
// it is ready, so the compiler does both: the reload hook, then ready.
export function attachUnlaunchedSession(
  compiler: Pick<Compiler, 'hooks'>,
  session: {
    launches: boolean
    reloadEachBuild: () => void
    announceReady: () => void
  }
): void {
  if (session.launches) return

  session.reloadEachBuild()
  announceReadyOnCleanCompile(compiler, session.announceReady)
}

export function announceReadyOnCleanCompile(
  compiler: Pick<Compiler, 'hooks'>,
  announce: () => void
): void {
  if (!compiler?.hooks?.done?.tap) return

  compiler.hooks.done.tap('extjs-session-ready', (stats: Stats) => {
    if (!stats?.hasErrors?.()) announce()
  })
}
