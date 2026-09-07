//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {readBrowserInstall} from './browser-install-outcome'
import {getCliPackageJson} from './cli-package-json'
import {CODES} from './messaging'
import {
  resolveTelemetryConsent,
  resolveTelemetryStorage,
  Telemetry,
  type TelemetrySource,
  writeConsent
} from './telemetry'
import {listTemplates, templateAliasFor} from './template-catalog'

type KnownCommand =
  | 'build'
  | 'capabilities'
  | 'create'
  | 'dev'
  | 'doctor'
  | 'eval'
  | 'inspect'
  | 'install'
  | 'logs'
  | 'open'
  | 'preview'
  | 'publish'
  | 'reload'
  | 'start'
  | 'storage'
  | 'telemetry'
  | 'uninstall'
  | 'unknown'

// Every command the CLI registers. An unlisted verb reports as 'unknown', which
// is what keeps a project path or a typo out of the payload, so the list has to
// stay complete or half the failures land under 'unknown'. A spec pins it to the
// registered commands.
export const KNOWN_COMMANDS: ReadonlySet<KnownCommand> = new Set([
  'build',
  'capabilities',
  'create',
  'dev',
  'doctor',
  'eval',
  'inspect',
  'install',
  'logs',
  'open',
  'preview',
  'publish',
  'reload',
  'start',
  'storage',
  'telemetry',
  'uninstall',
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

function readArgValue(argv: string[], names: string[]): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue

    for (const name of names) {
      if (arg === name) {
        const next = argv[i + 1]
        return next && !next.startsWith('-') ? next : undefined
      }

      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
    }
  }

  return undefined
}

/* @invariant ATTRIBUTION IS READ FROM ARGV, NEVER FROM THE PARSED OPTIONS.
 *
 * `--source` is declared on the create command and its action destructures
 * only {template, install}, so commander's parsed value is thrown away and
 * this re-parse is the ONLY thing carrying the tag to the wire. That reads
 * like a bug and is the design: the flag's whole contract is "recorded in
 * anonymous telemetry only", and telemetry runs from a process hook that
 * never sees an action's arguments. Rewriting this to consume the parsed
 * options would silently retire the tag with every spec still green, so
 * create-source-attribution.spec.ts pins both halves together.
 */
// Only an advertised starter name travels. A GitHub URL, a local folder or
// any other freeform value names the person's own project, which the
// published collection list promises never leaves the machine; those send
// no template at all, and the failure count for the starter still lands.
export function advertisedTemplateName(
  value: string | undefined
): string | undefined {
  if (!value) return undefined
  const name = value.trim()
  if (!name) return undefined
  if (listTemplates().includes(name)) return name
  if (templateAliasFor(name)) return name
  return undefined
}

export function telemetryCommandContext(
  command: string,
  argv: string[] = process.argv
): {
  template?: string
  source?: string
  browser_install?: string
  browser_install_browser?: string
  browser_install_seconds?: number
} {
  // Whether the first-run download offer converts, on whichever command made
  // it. Four fixed outcomes and a managed browser name, never a path.
  const install = readBrowserInstall()
  const installContext = install
    ? {
        browser_install: install.outcome,
        browser_install_browser: install.browser,
        ...(install.seconds === undefined
          ? {}
          : {browser_install_seconds: install.seconds})
      }
    : {}

  if (command !== 'create') return installContext

  return {
    ...installContext,
    template: advertisedTemplateName(readArgValue(argv, ['--template', '-t'])),
    source: readArgValue(argv, ['--source']) || 'cli'
  }
}

const consent = resolveTelemetryConsent(process.argv)
const invoked = detectInvokedCommand(process.argv)
const version = String(getCliPackageJson().version || '0.0.0')

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
    version,
    ...telemetryCommandContext(command)
  })
}

export interface CommandFailureDetails {
  // A CODES value. Anything else is dropped, so a message never travels.
  code?: unknown
  exitCode?: unknown
}

// Only a catalog code travels. An error message carries paths and project
// names, and a freeform code would be the same leak by another name.
export function telemetryFailureCode(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined
  return Object.prototype.hasOwnProperty.call(CODES, code) ? code : undefined
}

// A process exit code is a small integer. Anything else is not one.
export function telemetryExitCode(exitCode: unknown): number | undefined {
  if (typeof exitCode !== 'number') return undefined
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    return undefined
  }
  return exitCode
}

export function markCommandFailure(
  command = invoked,
  details: CommandFailureDetails = {}
): void {
  if (!markTracked()) return
  const code = telemetryFailureCode(details.code)
  const exitCode = telemetryExitCode(details.exitCode)
  telemetry.track('command_failed', {
    command,
    success: false,
    version,
    ...(code ? {code} : {}),
    ...(exitCode === undefined ? {} : {exit_code: exitCode}),
    ...telemetryCommandContext(command)
  })
}

function printOptOutNoticeIfFirstRun(): void {
  if (!consent.enabled || consent.source !== 'default') return

  const storage = resolveTelemetryStorage()
  if (!storage) return

  // Persist 'enabled' so the notice prints only once per machine.
  const written = writeConsent('enabled')
  if (!written) return

  // Notices go to stderr: stdout carries command results, and a machine
  // reading `--output json` must not have to strip a first-run banner.
  // eslint-disable-next-line no-console
  console.error(
    `${colors.gray('⏵⏵⏵')} Extension.js collects anonymous, opt-out telemetry (two events: ` +
      `${colors.cyan('command_executed')} + ${colors.cyan('command_failed')}). ` +
      `Disable with ${colors.cyan('extension telemetry disable')}, ` +
      `${colors.cyan('EXTENSION_TELEMETRY=0')}, or ${colors.cyan('--no-telemetry')}. ` +
      `See docs/TELEMETRY.md.`
  )
}

if (consent.enabled) {
  printOptOutNoticeIfFirstRun()

  process.on('beforeExit', async () => {
    if (!tracked) {
      if ((process.exitCode ?? 0) === 0) {
        markCommandSuccess()
      } else {
        markCommandFailure()
      }
    }
    await telemetry.flush()
  })

  process.on('uncaughtException', () => {
    markCommandFailure()
  })

  process.on('unhandledRejection', () => {
    markCommandFailure()
  })
}
