//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import colors from 'pintor'
import {
  Telemetry,
  resolveTelemetryConsent,
  resolveTelemetryStorage,
  writeConsent,
  type TelemetrySource
} from './telemetry'
import {getCliPackageJson} from './cli-package-json'

type KnownCommand =
  | 'create'
  | 'dev'
  | 'start'
  | 'preview'
  | 'build'
  | 'install'
  | 'uninstall'
  | 'telemetry'
  | 'unknown'

const KNOWN_COMMANDS: ReadonlySet<KnownCommand> = new Set([
  'create',
  'dev',
  'start',
  'preview',
  'build',
  'install',
  'uninstall',
  'telemetry',
  'unknown'
])

export function detectInvokedCommand(argv: string[]): KnownCommand {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg || arg.startsWith('-')) continue
    if (KNOWN_COMMANDS.has(arg as KnownCommand)) return arg as KnownCommand
    return 'unknown'
  }
  return 'unknown'
}

const consent = resolveTelemetryConsent(process.argv)
const invoked = detectInvokedCommand(process.argv)
const version = getCliPackageJson().version

export const telemetry = new Telemetry({
  app: 'extension',
  version,
  disabled: !consent.enabled
})

export function getTelemetryConsent(): {
  enabled: boolean
  source: TelemetrySource
} {
  return consent
}

export function setTelemetryConsent(value: 'enabled' | 'disabled'): {
  ok: boolean
  path: string | null
} {
  const ok = writeConsent(value)
  const storage = resolveTelemetryStorage()
  return {ok, path: storage?.consentFile ?? null}
}

let tracked = false

function markTracked(): boolean {
  if (tracked) return false
  tracked = true
  return true
}

export function markCommandSuccess(command = invoked): void {
  if (!markTracked()) return
  telemetry.track('command_executed', {
    command,
    success: true,
    version
  })
}

export function markCommandFailure(command = invoked): void {
  if (!markTracked()) return
  telemetry.track('command_failed', {
    command,
    success: false,
    version
  })
}

function printOptOutNoticeIfFirstRun(): void {
  if (!consent.enabled || consent.source !== 'default') return

  const storage = resolveTelemetryStorage()
  if (!storage) return

  // Persist 'enabled' so the notice prints only once per machine.
  const written = writeConsent('enabled')
  if (!written) return

  // eslint-disable-next-line no-console
  console.log(
    `${colors.gray('⏵⏵⏵')} Extension.js collects anonymous, opt-out telemetry (two events: ` +
      `${colors.cyan('command_executed')} + ${colors.cyan('command_failed')}). ` +
      `Disable with ${colors.cyan('extension telemetry disable')}, ` +
      `${colors.cyan('EXTENSION_TELEMETRY=0')}, or ${colors.cyan('--no-telemetry')}. ` +
      `See TELEMETRY.md.`
  )
}

if (consent.enabled) {
  printOptOutNoticeIfFirstRun()

  process.on('beforeExit', async function () {
    if (!tracked) {
      if ((process.exitCode ?? 0) === 0) {
        markCommandSuccess()
      } else {
        markCommandFailure()
      }
    }
    await telemetry.flush()
  })

  process.on('uncaughtException', function () {
    markCommandFailure()
  })

  process.on('unhandledRejection', function () {
    markCommandFailure()
  })
}
