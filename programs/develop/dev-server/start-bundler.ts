// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, Stats} from '@rspack/core'
import {type CodedError, codedError} from '../lib/coded-error'
import {CODES, type ErrorCode, stripChannelPrefix} from '../lib/messaging'
import {humanLine} from './lifecycle-stream'
import * as messages from './messages'

export const DEFAULT_START_TIMEOUT_MS = 30000

// A value that is not a positive number would arm the slow-start warning for
// the next tick, so it falls back to the default.
export function readStartTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const parsed = parseInt(String(env.EXTENSION_START_TIMEOUT_MS ?? ''), 10)

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_START_TIMEOUT_MS
}

export interface StartBundlerOptions {
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
export interface DevServerStartError extends CodedError {
  cause: unknown
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
  metadata: {writeError: (code: string, message: string) => void}
  lifecycle: {failed: (message: string) => void}
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

    targets.lifecycle.failed(
      error instanceof Error ? error.message : String(error)
    )

    // The caller prints and reports its own rejection, so nothing is said twice.
    if (!exitOnError) throw devServerStartError(error)

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
  metadata: {writeError: (code: string, message: string) => void}
  lifecycle: {
    failed: (message: string) => void
    restartFailed: (args: {code: ErrorCode; message: string}) => void
  }
  // Puts the session back on the compiler that is still serving.
  keepServing: () => void
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

  return {
    bundle(error: unknown): void {
      targets.keepServing()
      print(messages.devServerRestartFailed(error, 'previous-build'))

      targets.lifecycle.restartFailed({
        code: declaredErrorCode(error) ?? CODES.E_DEV_SERVER_START,
        message: stripChannelPrefix(errorMessage(error))
      })
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
    // Anything the steps above did not expect still gets its line.
    unexpected(error: unknown): void {
      print(messages.devServerRestartFailed(error, 'unknown'))
    }
  }
}

export interface FailedStartRelease {
  server: {stop?: () => Promise<void>}
  releasePort: () => Promise<void>
  closeControlBridge: () => Promise<void>
  stopTimeoutMs?: number
}

// Best effort and bounded: a server that never listened may not answer stop,
// and the caller is owed its rejection either way.
export async function releaseFailedStart(
  release: FailedStartRelease
): Promise<void> {
  const steps = [
    () => release.server.stop?.(),
    release.releasePort,
    release.closeControlBridge
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

export function announceReadyOnCleanCompile(
  compiler: Pick<Compiler, 'hooks'>,
  announce: () => void
): void {
  if (!compiler?.hooks?.done?.tap) return

  compiler.hooks.done.tap('extjs-session-ready', (stats: Stats) => {
    if (!stats?.hasErrors?.()) announce()
  })
}
