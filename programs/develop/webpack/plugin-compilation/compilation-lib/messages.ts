import colors from 'pintor'
import type {Stats} from '@rspack/core'

export function boring(manifestName: string, durationMs: number, stats: Stats) {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timestamp = colors.gray(`[${hh}:${mm}:${ss}]`)

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
  const app = manifestName
  const time = `${durationMs} ms`
  return `${arrow} ${timestamp} ${app} compiled ${label} in ${time}.`
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

export function cleanDistStarting(distPath: string) {
  return `${colors.gray('►►►')} Clean dist: ${colors.gray('starting')}\n${colors.gray('PATH')} ${colors.underline(distPath)}`
}

export function cleanDistRemovedSummary(
  removedCount: number,
  distPath: string
) {
  return [
    `${colors.underline('Clean dist (completed)')}`,
    `${colors.gray('REMOVED')} ${colors.gray(String(removedCount))}`,
    `${colors.gray('PATH')} ${colors.underline(distPath)}`
  ].join('\n')
}

export function cleanDistSkippedNotFound(distPath: string) {
  return `${colors.gray('►►►')} Clean dist: ${colors.gray('skipped')} (path not found)\n${colors.gray('PATH')} ${colors.underline(distPath)}`
}

export function zipPackagingSkipped(reason: string) {
  return `${colors.gray('►►►')} Packaging: ${colors.gray('skipped')} (${colors.gray(reason)})`
}

export function envSelectedFile(envPath: string) {
  const label = envPath ? colors.underline(envPath) : colors.gray('none')
  return [
    `${colors.underline('Environment')}`,
    `${colors.gray('PATH')} ${label}`
  ].join('\n')
}

export function envInjectedPublicVars(count: number) {
  return [
    `${colors.underline('Environment')}`,
    `${colors.gray('INJECTED')} ${colors.gray(String(count))} EXTENSION_PUBLIC_*`
  ].join('\n')
}
