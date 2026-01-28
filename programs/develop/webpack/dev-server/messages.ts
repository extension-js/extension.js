// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import colors from 'pintor'

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success') {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    // Author mode: magenta, clearly branded, keeps three-element prefix shape
    const base = type === 'error' ? 'ERROR Author says' : '►►► Author says'
    return colors.brightMagenta(base)
  }

  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return colors.gray('►►►')
  return colors.green('►►►')
}

export function ready(mode: 'development' | 'production', browser: string) {
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' || browser === 'edge'
      ? 'Add-on'
      : 'Extension'
  const b = String(browser || '')
  const cap = b.charAt(0).toUpperCase() + b.slice(1)
  const pretty = colors.green('ready for ' + mode)
  return `${getLoggingPrefix('info')} ${cap} ${extensionOutput} ${pretty}.`
}

export function browserRunnerDisabled() {
  return `${getLoggingPrefix('info')} Browser runner disabled (no-runner).`
}

export function portInUse(requestedPort: number, newPort: number) {
  return `Port: Requested port ${colors.brightBlue(requestedPort.toString())} is in use; using ${colors.brightBlue(newPort.toString())} instead.`
}

export function extensionJsRunnerError(error: unknown) {
  return `Extension.js Runner Error:\n${colors.red(String(error))}`
}

export function autoExitModeEnabled(ms: number) {
  return `Auto-exit enabled. Will exit after ${colors.brightBlue(ms.toString())} ms if idle.`
}

export function autoExitTriggered(ms: number) {
  return `Auto-exit triggered after ${colors.brightBlue(ms.toString())} ms. Cleaning up...`
}

export function autoExitForceKill(ms: number) {
  return `Force-killing process after ${colors.brightBlue(ms.toString())} ms to ensure exit.`
}

// Dev server startup watchdog message
export function devServerStartTimeout(ms: number) {
  return [
    `Dev server startup is taking longer than expected (${colors.brightBlue(ms.toString())} ms).`,
    `The bundler may have encountered an error before emitting the first build.`,
    `If nothing else prints, try setting ${colors.brightBlue('EXTENSION_VERBOSE=1')} for more logs.`
  ].join('\n')
}

// Fatal bundler error surfaced by compiler.hooks.failed
export function bundlerFatalError(error: unknown) {
  const text =
    error instanceof Error ? error.stack || error.message : String(error)
  return `Build failed to start:\n${colors.red(text)}`
}

// Compilation finished with errors
export function bundlerCompileFailed(errors: Array<any>) {
  const count = (errors && errors.length) || 0
  const formatOne = (e: any) => {
    if (!e) return ''
    if (typeof e === 'string') return e
    if (e?.message) return e.message
    try {
      return JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  const preview = (errors || []).slice(0, 3).map(formatOne).join('\n\n')
  const more =
    count > 3
      ? `\n\n… and ${colors.brightBlue(String(count - 3))} more error(s).`
      : ''
  return `Compilation failed with ${colors.brightBlue(String(count))} error(s):\n\n${colors.red(preview)}${more}`
}

// Optional low-noise message on invalidation
export function bundlerRecompiling() {
  return `Recompiling due to file changes…`
}

// No entrypoints produced by the compiler
export function noEntrypointsDetected(port: number) {
  return [
    `No entrypoints or assets were produced by the initial compilation.`,
    `The dev server is running on 127.0.0.1:${colors.brightBlue(port.toString())}, but nothing is being built.`,
    `Possible causes:`,
    `  • Empty or missing entry configuration.`,
    `  • Extension-related plugins are disabled (entries not derived from manifest).`,
    `  • All sources are ignored or excluded.`,
    `Try enabling verbose logs with ${colors.brightBlue('EXTENSION_VERBOSE=1')} or review your extension config.`
  ].join('\n')
}

export function devServerConfig(
  host: string,
  port: number,
  hmrEnabled: boolean,
  wsHost: string,
  wsPort: number,
  pollingIntervalMs: number
) {
  const heading = 'Dev server'
  return [
    heading,
    `${colors.gray('HOST')} ${colors.underline(host)}`,
    `${colors.gray('PORT')} ${colors.underline(String(port))}`,
    `${colors.gray('HMR')} ${hmrEnabled ? colors.green('enabled') : colors.gray('disabled')}`,
    `${colors.gray('WS')} ${colors.underline(`${wsHost}:${wsPort}`)}`,
    `${colors.gray('POLLING')} ${colors.underline(String(pollingIntervalMs))}${colors.gray('ms')}`
  ].join('\n')
}

export function devServerWsSummary(connections: number) {
  return `${getLoggingPrefix('info')} DevServer: WS connections ${colors.underline(String(connections))}`
}
