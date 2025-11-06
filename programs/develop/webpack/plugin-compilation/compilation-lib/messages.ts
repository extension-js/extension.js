import colors from 'pintor'
import type {Stats} from '@rspack/core'

export function boring(manifestName: string, durationMs: number, stats: Stats) {
  const hasErrors = stats.hasErrors()
  const hasWarnings = stats.hasWarnings()

  const arrow = hasErrors
    ? colors.red('✖✖✖')
    : hasWarnings
      ? colors.brightYellow('►►►')
      : colors.gray('►►►')
  const label = hasErrors
    ? colors.red('with errors')
    : hasWarnings
      ? colors.yellow('with warnings')
      : colors.green('successfully')
  return `${arrow} ${manifestName} compiled ${label} in ${durationMs} ms.`
}

export function portInUse(requestedPort: number, newPort: number) {
  return `Port: Requested port ${colors.brightBlue(requestedPort.toString())} is in use; using ${colors.brightBlue(newPort.toString())} instead.`
}

export function extensionJsRunnerError(error: unknown) {
  return `Extension.js Runner Error:\n${colors.red(String(error))}`
}

export function extensionJsRunnerCleanupError(error: unknown) {
  return `Extension.js Runner Cleanup Error:\n${colors.red(String(error))}`
}

export function extensionJsRunnerUncaughtException(error: unknown) {
  const err = error as any
  const stack = (err && (err.stack || err.message)) || String(error)
  return `Extension.js Runner Uncaught exception.\n${colors.red(String(stack))}`
}

export function extensionJsRunnerUnhandledRejection(
  promise: Promise<any>,
  reason: unknown
) {
  return `Extension.js Runner unhandled rejection at: ${colors.brightBlue(promise.toString())} reason: ${colors.red(String(reason))}`
}
