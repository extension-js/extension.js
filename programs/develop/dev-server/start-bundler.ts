// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, Stats} from '@rspack/core'
import {CODES} from '../lib/messaging'
import {humanLine} from './lifecycle-stream'
import * as messages from './messages'

export function readStartTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return parseInt(String(env.EXTENSION_START_TIMEOUT_MS || '30000'), 10)
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

export interface StartFailureTargets {
  metadata: {writeError: (code: string, message: string) => void}
  lifecycle: {failed: (message: string) => void}
  onExitError?: (error: unknown, code?: string) => void
  print?: (line: string) => void
  exit?: (code: number) => never
}

export function createStartFailure(targets: StartFailureTargets) {
  const print = targets.print ?? humanLine
  const exit = targets.exit ?? ((code: number) => process.exit(code))

  return (error: unknown): never => {
    targets.metadata.writeError(
      'dev_server_start_failed',
      error instanceof Error ? error.message : String(error)
    )

    targets.lifecycle.failed(
      error instanceof Error ? error.message : String(error)
    )

    print(messages.extensionJsRunnerError(error))

    try {
      targets.onExitError?.(error, CODES.E_DEV_SERVER_START)
    } catch {
      // Best-effort: a caller's report must never change how the run ends.
    }

    return exit(1)
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
