//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Stats} from '@rspack/core'
import colors from 'pintor'
import {prefix} from '../../lib/messaging'

export function boring(manifestName: string, durationMs: number, stats: Stats) {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timestamp = colors.gray(`[${hh}:${mm}:${ss}]`)

  const hasErrors = stats.hasErrors()
  const hasWarnings = stats.hasWarnings()

  // One glyph across all five channels; the color carries the severity.
  const arrow = hasErrors
    ? prefix('error')
    : hasWarnings
      ? prefix('warn')
      : prefix('info')
  const status = hasErrors
    ? `compiled ${colors.red('with errors')}`
    : hasWarnings
      ? `compiled ${colors.yellow('with warnings')}`
      : 'compiled'
  const app = manifestName
  const time = `${durationMs} ms`
  return `${arrow} ${timestamp} ${app} ${status} in ${time}.`
}

export function portInUse(requestedPort: number, newPort: number) {
  return (
    `Port ${colors.brightBlue(requestedPort.toString())} is in use.\n` +
    `The dev server listens on port ${colors.brightBlue(newPort.toString())} instead.`
  )
}

export function extensionJsRunnerError(error: unknown) {
  return `Extension.js could not start the runner.\n${colors.red(String(error))}`
}

export function cleanDistStarting(distPath: string) {
  return `${prefix('debug')} clean    start path=${distPath}`
}

export function cleanDistRemovedSummary(
  removedCount: number,
  distPath: string
) {
  return `${prefix('debug')} clean    removed=${removedCount} path=${distPath}`
}

export function cleanDistSkippedNotFound(distPath: string) {
  return `${prefix('debug')} clean    skipped=not-found path=${distPath}`
}

export function zipPackagingSkipped(reason: string) {
  return `${prefix('debug')} zip      skipped=true reason="${reason}"`
}

export function envSelectedFile(envPath: string) {
  return `${prefix('debug')} env      file=${envPath || 'none'}`
}

export function envInjectedPublicVars(count: number) {
  return `${prefix('debug')} env      injected=${count} prefix=EXTENSION_PUBLIC_`
}

export function envNoMatchingFile(
  browser: string,
  mode: string,
  presentFiles: string[],
  expectedCandidates: string[]
) {
  return (
    `Found ${presentFiles.map((file) => colors.yellow(file)).join(', ')}, ` +
    `but none match browser ${colors.yellow(browser)} in mode ${colors.yellow(
      mode
    )}.\n` +
    `EXTENSION_PUBLIC_* variables read from code are ` +
    `${colors.yellow('undefined')} in this build.\n` +
    `Rename the file to one of these, in priority order: ` +
    `${expectedCandidates.map((file) => colors.gray(file)).join(', ')}.\n` +
    `Family names apply to every family member, so ` +
    `${colors.yellow('.env.chrome')} also matches ${colors.yellow(
      'chromium'
    )} and ${colors.yellow('edge')} targets.`
  )
}
