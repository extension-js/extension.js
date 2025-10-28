import fs from 'fs'
import path from 'path'
import {Telemetry} from './telemetry'
import packageJson from '../package.json'
import {summarizeManifest} from './manifest-summary'

// Initialize telemetry singleton for CLI
// Opt-out is controlled via CLI flag only: --no-telemetry
function isTelemetryDisabledFromArgs(argv: string[]): boolean {
  return argv.includes('--no-telemetry')
}

const telemetryDisabled = isTelemetryDisabledFromArgs(process.argv)

export const telemetry = new Telemetry({
  app: 'extension',
  version: packageJson.version,
  disabled: telemetryDisabled
})

if (!telemetryDisabled) {
  const startedAt = Date.now()
  const known = new Set([
    'create',
    'dev',
    'start',
    'preview',
    'build',
    'cleanup'
  ])
  const invoked = (process.argv.slice(2).find((a) => known.has(a)) ||
    'unknown') as
    | 'create'
    | 'dev'
    | 'start'
    | 'preview'
    | 'build'
    | 'cleanup'
    | 'unknown'

  telemetry.track('cli_boot', {
    command_guess: invoked
  })

  // Attempt to emit a one-time, privacy-safe manifest summary when present
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const json = JSON.parse(raw)
    const summary = summarizeManifest(json)
    telemetry.track('manifest_summary', summary)
  }

  process.on('beforeExit', async function () {
    telemetry.track('cli_shutdown', {
      command_guess: invoked,
      duration_ms: Date.now() - startedAt,
      exit_code: process.exitCode ?? 0
    })
    await telemetry.flush()
  })

  process.on('uncaughtException', function (err) {
    telemetry.track('cli_error', {
      command_guess: invoked,
      error_name: String((err as any)?.name || 'Error').slice(0, 64)
    })
  })

  process.on('unhandledRejection', function (reason: any) {
    telemetry.track('cli_error', {
      command_guess: invoked,
      error_name: String(reason?.name || 'PromiseRejection').slice(0, 64)
    })
  })
}
