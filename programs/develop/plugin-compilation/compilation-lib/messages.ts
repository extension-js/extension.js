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
import {displayPath} from '../../lib/paths'

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

export function envValueBreaksJsonAsset(asset: string, names: string[]) {
  return (
    `${colors.yellow(asset)} is not valid JSON after substituting ` +
    `${names.map((name) => colors.yellow(`$${name}`)).join(', ')}.\n` +
    `Quote the placeholder to get a JSON string: ${colors.gray(`"$${names[0]}"`)}. ` +
    `An unquoted placeholder takes the value as written, so the value must be JSON itself.`
  )
}

// A live session cannot re-read the config file: the loader caches it and the
// merged options are a session-scoped snapshot. Say so instead of compiling
// clean and leaving the author to wonder which build their edit landed in.
export function projectConfigChangedRestartRequired(configPath: string) {
  return (
    `${colors.yellow(displayPath(configPath))} changed. This session keeps ` +
    `running the config it read at startup.\n` +
    `Stop it and run ${colors.blue('extension dev')} again to apply the change.`
  )
}

// The fallback for a watch run with no dev session to restart, where the
// values this build inlined stay the ones read when the compiler was created.
export function envChangedRestartRequired(envPath: string) {
  return (
    `${colors.yellow(displayPath(envPath))} changed. The values this build ` +
    `inlined are the ones read when the compiler started.\n` +
    `Restart the dev server to apply the change.`
  )
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
