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

// The verb this run invoked, for the exit path that reports an outcome the
// command never got to mark itself.
export function invokedCommand(): string {
  return invoked
}

export function setTelemetryConsent(value: 'enabled' | 'disabled'): {
  ok: boolean
  path: string | null
} {
  const ok = writeConsent(value)
  // A refusal covers the run that made it, so `extension telemetry disable`
  // never reports itself. Enabling starts at the next run, not this one.
  if (value === 'disabled') telemetry.disable()
  const storage = resolveTelemetryStorage()
  return {ok, path: storage?.consentFile ?? null}
}

let tracked = false
let sessionStarted = false

function markTracked(): boolean {
  if (tracked) return false
  tracked = true
  return true
}

/* @invariant A WATCH SESSION IS COUNTED WHEN IT STARTS, BECAUSE THE ONLY OTHER
 * MOMENT AVAILABLE IS ONE THIS PROCESS NEVER REACHES.
 *
 * `markCommandSuccess` runs after `parseAsync` resolves, and `dev`, `start` and
 * `preview` never resolve it: they watch until a signal kills them. The
 * `beforeExit` fallback cannot stand in either, because Node does not emit that
 * event for a signal death. So a successful dev session emitted nothing at all,
 * and the only `dev` rows that ever reached the collector were the runs that
 * crashed before the watch loop began. Read on 2026-09-09 that was 28 events
 * across 16 users reporting a 66% failure rate, which described the sampling
 * and not the product.
 *
 * Two things follow from that, and both are load bearing. The event is emitted
 * at the handoff to the long-running runtime rather than held for the exit, and
 * it is flushed right there rather than queued, so a `SIGKILL`, a lost flush or
 * a `process.exit` from another signal handler cannot erase the session.
 *
 * It stays `command_executed`. A third event name would have split the one
 * question the two-event scheme answers, "did this command work", across two
 * vocabularies. `session: 'started'` says which half of the run the row
 * describes while `command_failed` keeps its exact meaning, so a failure that
 * lands after the session came up still travels and the failure rate for `dev`
 * finally has a denominator counted the same way as its numerator.
 */
export function markCommandSessionStart(command = invoked): void {
  if (tracked || sessionStarted) return
  sessionStarted = true
  telemetry.track('command_executed', {
    command,
    success: true,
    version,
    session: 'started',
    ...telemetryCommandContext(command)
  })
  // Sent now, not queued. Holding it for the exit is the defect being fixed.
  void telemetry.flush()
}

export function hasTrackedSessionStart(): boolean {
  return sessionStarted
}

export function markCommandSuccess(command = invoked): void {
  // A session already counted at its start is one run, not two: its clean exit
  // adds nothing, and `command_failed` is still free to report a later death.
  if (sessionStarted) return
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
