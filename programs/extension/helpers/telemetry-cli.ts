//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {
  isChromiumBrowser,
  isFirefoxBrowser
} from '../browsers/browsers-lib/browser-family'
import {readBrowserInstall} from './browser-install-outcome'
import {resolveCommandFromArgv} from './cli-argv'
import {getCliPackageJson} from './cli-package-json'
import {readDependencyInstall} from './dependency-install-outcome'
import {KNOWN_COMMANDS, type KnownCommand} from './known-commands'
import {CODES} from './messaging'
import {
  createTelemetryKit,
  TELEMETRY_DOCS_URL,
  Telemetry,
  type TelemetryBrowser,
  type TelemetryConsent,
  type TelemetryDeps,
  type TelemetryReset
} from './telemetry'
import {
  type FailureStep,
  isFailureStep,
  telemetryErrorClass
} from './telemetry-error-class'
import {
  DEFAULT_TEMPLATE,
  listTemplates,
  templateAliasFor
} from './template-catalog'

export {KNOWN_COMMANDS}

// Same scan the JSON envelope uses, so `--output json dev` reports `dev` in
// both places instead of reading the flag's value as the command.
export function detectInvokedCommand(
  argv: string[],
  valuedFlags: ReadonlySet<string> = new Set()
): KnownCommand {
  const arg = resolveCommandFromArgv(argv, valuedFlags)

  return arg && KNOWN_COMMANDS.has(arg as KnownCommand)
    ? (arg as KnownCommand)
    : 'unknown'
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

// The surfaces that start a create. The tag is a word from this list or it
// is `cli`: a freeform value would be a project identifier by another name.
const CREATE_SOURCES: ReadonlySet<string> = new Set(['cli', 'templates'])

export function createSourceTag(value: string | undefined): string {
  const tag = String(value ?? '')
    .trim()
    .toLowerCase()

  return CREATE_SOURCES.has(tag) ? tag : 'cli'
}

function hasFlag(argv: string[], names: string[]): boolean {
  return argv
    .slice(2)
    .some((arg) =>
      names.some((name) => arg === name || arg.startsWith(`${name}=`))
    )
}

// The starter a create ran with. No flag at all means the default starter,
// sent exactly as its name typed after --template would be.
export function createTemplateName(argv: string[]): string | undefined {
  if (!hasFlag(argv, ['--template', '-t'])) return DEFAULT_TEMPLATE

  return advertisedTemplateName(readArgValue(argv, ['--template', '-t']))
}

// One browser name as one of six fixed words. A fork is its engine family,
// and a name outside both families has no word, so it is not sent.
export function telemetryBrowserWord(
  name: string | undefined
): TelemetryBrowser | undefined {
  if (name === 'chrome' || name === 'edge' || name === 'firefox') return name
  if (name === 'safari') return name
  if (!name) return undefined
  if (isChromiumBrowser(name)) return 'chromium-based'
  if (isFirefoxBrowser(name)) return 'gecko-based'

  return undefined
}

// The browsers a command resolved, from the flag, the config file or the
// default. Several browsers are one run and one row, so they send nothing.
export function telemetryBrowser(
  resolved: readonly string[] | undefined,
  argv: string[]
): TelemetryBrowser | undefined {
  if (!resolved || resolved.length !== 1) return undefined

  const word = telemetryBrowserWord(resolved[0])
  if (!word) return undefined

  // A custom binary is known by its engine alone, whatever name was typed.
  if (isChromiumBrowser(word) && hasFlag(argv, ['--chromium-binary'])) {
    return 'chromium-based'
  }

  if (
    isFirefoxBrowser(word) &&
    hasFlag(argv, ['--gecko-binary', '--firefox-binary'])
  ) {
    return 'gecko-based'
  }

  return word
}

export type TelemetryCommandContext = {
  template?: string
  browser?: TelemetryBrowser
  source?: string
  browser_install?: string
  browser_install_browser?: string
  browser_install_seconds?: number
  deps_install?: string
  deps_install_seconds?: number
  install_target?: string
}

type InstallReaders = {
  readBrowserInstall: typeof readBrowserInstall
  readDependencyInstall: typeof readDependencyInstall
}

// The browser an install was asked for, as one word the payload gate also
// knows. Several names, an alias or a typed path send nothing.
const INSTALL_TARGET_WORDS: ReadonlySet<string> = new Set([
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'all'
])

function commandContextWith(
  readers: InstallReaders,
  command: string,
  argv: string[],
  resolvedBrowsers?: readonly string[],
  installTarget?: string
): TelemetryCommandContext {
  // Whether the first-run download offer converts, on whichever command made
  // it. Four fixed outcomes and a managed browser name, never a path.
  const install = readers.readBrowserInstall()
  const installContext = install
    ? {
        browser_install: install.outcome,
        browser_install_browser: install.browser,
        ...(install.seconds === undefined
          ? {}
          : {browser_install_seconds: install.seconds}),
        ...targetContext(command, installTarget)
      }
    : targetContext(command, installTarget)

  const browser = telemetryBrowser(resolvedBrowsers, argv)
  if (browser) return {...installContext, browser}
  if (command !== 'create') return installContext

  const deps = readers.readDependencyInstall()

  return {
    ...installContext,
    template: createTemplateName(argv),
    source: createSourceTag(readArgValue(argv, ['--source'])),
    ...(deps ? {deps_install: deps.outcome} : {}),
    ...(deps?.seconds === undefined ? {} : {deps_install_seconds: deps.seconds})
  }
}

function targetContext(
  command: string,
  installTarget: string | undefined
): Pick<TelemetryCommandContext, 'install_target'> {
  if (command !== 'install' || !installTarget) return {}

  return INSTALL_TARGET_WORDS.has(installTarget)
    ? {install_target: installTarget}
    : {}
}

export function telemetryCommandContext(
  command: string,
  argv: string[] = process.argv
): TelemetryCommandContext {
  return commandContextWith(
    {readBrowserInstall, readDependencyInstall},
    command,
    argv
  )
}

// How long a crashing process waits for its failure report to be
// acknowledged before the default death goes on, startup of the sender
// included. Short, so a hung sink cannot hold a dying process long.
const CRASH_FLUSH_TIMEOUT_MS = 1000

export interface CommandFailureDetails {
  // A CODES value. Anything else is dropped, so a message never travels.
  code?: unknown
  exitCode?: unknown
  // Read only on an E_INTERNAL row, and only as a word from a fixed list.
  error?: unknown
  step?: FailureStep
}

// What an unclassified failure can say about itself: the error's class and
// where it was thrown, each a fixed word. Nothing for any other code.
function internalFailureContext(
  code: string | undefined,
  details: CommandFailureDetails
): {error_class?: string; error_step?: FailureStep} {
  if (code !== CODES.E_INTERNAL) return {}

  return {
    ...('error' in details
      ? {error_class: telemetryErrorClass(details.error)}
      : {}),
    ...(isFailureStep(details.step) ? {error_step: details.step} : {})
  }
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

// The three process calls the exit hooks make.
export interface TelemetryHost {
  on(
    event: 'beforeExit' | 'uncaughtExceptionMonitor',
    listener: () => unknown
  ): void
  listenerCount(event: 'uncaughtException'): number
  exitCode(): number | string | null | undefined
}

const processHost: TelemetryHost = {
  on: (event, listener) => {
    process.on(event as 'beforeExit', listener)
  },
  listenerCount: (event) => process.listenerCount(event),
  exitCode: () => process.exitCode
}

export interface TelemetryCliDeps extends TelemetryDeps, InstallReaders {
  argv: string[]
  version: string
  printNotice: (line: string) => void
  host: TelemetryHost
}

// What `extension telemetry status` answers: the decision and what is stored.
export type TelemetryStatus = TelemetryConsent & {
  anonymousId: string | null
  consentFile: string | null
  auditFile: string | null
}

export interface TelemetryCli {
  telemetry: Telemetry
  getConsent(): TelemetryConsent
  getStatus(): TelemetryStatus
  reset(): TelemetryReset
  // Called by a command once it knows which browsers the run targets.
  noteBrowsers(resolved: readonly string[]): void
  // Called by install once it has read the names it was given.
  noteInstallTarget(target: string | undefined): void
  invokedCommand(): string
  resolveInvokedCommand(argv: string[], valuedFlags: ReadonlySet<string>): void
  setConsent(value: 'enabled' | 'disabled'): {ok: boolean; path: string | null}
  markCommandSessionStart(command?: string): void
  markCommandSessionReady(command?: string): void
  hasTrackedSessionStart(): boolean
  markCommandSuccess(command?: string): void
  markCommandFailure(command?: string, details?: CommandFailureDetails): void
  reportCommandFailureNow(details?: CommandFailureDetails): void
  // Prints the first-run notice and registers the exit hooks, when enabled.
  start(): void
}

// One run's telemetry. Every default is the CLI's own, so an empty call is
// the instance the entry point uses.
export function createTelemetryCli(
  overrides: Partial<TelemetryCliDeps> = {}
): TelemetryCli {
  const kit = createTelemetryKit(overrides)
  const argv = overrides.argv ?? process.argv
  const readers: InstallReaders = {
    readBrowserInstall: overrides.readBrowserInstall ?? readBrowserInstall,
    readDependencyInstall:
      overrides.readDependencyInstall ?? readDependencyInstall
  }
  const printNotice =
    overrides.printNotice ??
    ((line: string) => {
      // eslint-disable-next-line no-console
      console.error(line)
    })
  const host = overrides.host ?? processHost

  const consent = kit.resolveConsent(argv)
  let invoked: string = detectInvokedCommand(argv)
  const version =
    overrides.version ?? String(getCliPackageJson().version || '0.0.0')
  const telemetry = new Telemetry(
    {app: 'extension', version, disabled: !consent.enabled},
    kit
  )

  let resolvedBrowsers: readonly string[] | undefined
  let installTarget: string | undefined
  let tracked = false
  let sessionStarted = false
  let sessionReady = false

  function setConsent(value: 'enabled' | 'disabled'): {
    ok: boolean
    path: string | null
  } {
    const ok = kit.writeConsent(value)
    // A refusal covers the run that made it, so `extension telemetry disable`
    // never reports itself. Enabling starts at the next run, not this one.
    if (value === 'disabled') telemetry.disable()

    const storage = kit.resolveStorage()

    return {ok, path: storage?.consentFile ?? null}
  }

  // Read-only: a status never creates the folder, the ID or a probe file.
  function getStatus(): TelemetryStatus {
    const storage = kit.locateStorage()
    // An opt-in by variable with nowhere to write still sends nothing.
    const decided: TelemetryConsent =
      consent.enabled && !telemetry.isEnabled
        ? {enabled: false, source: 'storage'}
        : consent

    return {
      ...decided,
      anonymousId: storage ? kit.readId(storage.idFile) : null,
      consentFile: storage?.consentFile ?? null,
      auditFile: storage?.auditFile ?? null
    }
  }

  // Silenced first, so the run that resets leaves no audit line behind it.
  function reset(): TelemetryReset {
    telemetry.disable()

    return kit.resetState()
  }

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
  function markCommandSessionStart(command = invoked): void {
    if (tracked || sessionStarted) return

    sessionStarted = true
    telemetry.track('command_executed', {
      command,
      success: true,
      version,
      session: 'started',
      ...commandContextWith(
        readers,
        command,
        argv,
        resolvedBrowsers,
        installTarget
      )
    })

    // Sent now, not queued. Holding it for the exit is the defect being fixed.
    void telemetry.flush()
  }

  // Without this row a `dev` that opened its browser and one that hung before
  // it are the same started row. Sent once per process and right away, for the
  // reasons the started row is, and never for a session that was not counted
  // at its start or that already reported its failure.
  function markCommandSessionReady(command = invoked): void {
    if (!sessionStarted || sessionReady || tracked) return

    sessionReady = true
    telemetry.track('command_executed', {
      command,
      success: true,
      version,
      session: 'ready',
      ...commandContextWith(
        readers,
        command,
        argv,
        resolvedBrowsers,
        installTarget
      )
    })

    void telemetry.flush()
  }

  function markCommandSuccess(command = invoked): void {
    // A session already counted at its start is one run, not two: its clean exit
    // adds nothing, and `command_failed` is still free to report a later death.
    if (sessionStarted) return
    if (!markTracked()) return

    telemetry.track('command_executed', {
      command,
      success: true,
      version,
      ...commandContextWith(
        readers,
        command,
        argv,
        resolvedBrowsers,
        installTarget
      )
    })
  }

  function markCommandFailure(
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
      ...internalFailureContext(code, details),
      ...commandContextWith(
        readers,
        command,
        argv,
        resolvedBrowsers,
        installTarget
      )
    })
  }

  // For a refusal that ends in a bare process.exit, which skips beforeExit and
  // so the queued send. Bounded like the crash path, and only a failing run pays it.
  function reportCommandFailureNow(details: CommandFailureDetails = {}): void {
    markCommandFailure(undefined, details)
    telemetry.flushSync(CRASH_FLUSH_TIMEOUT_MS)
  }

  function printOptOutNoticeIfFirstRun(): void {
    if (!consent.enabled || consent.source !== 'default') return

    // Records the notice and persists 'enabled', so this prints once per machine
    // even where a stored 'enabled' cannot be honored.
    if (!kit.claimFirstRunNotice()) return

    // Notices go to stderr: stdout carries command results, and a machine
    // reading `--output json` must not have to strip a first-run banner.
    printNotice(
      `${colors.gray('⏵⏵⏵')} Extension.js collects anonymous, opt-out telemetry (two events: ` +
        `${colors.cyan('command_executed')} + ${colors.cyan('command_failed')}). ` +
        `Disable with ${colors.cyan('extension telemetry disable')}, ` +
        `${colors.cyan('EXTENSION_TELEMETRY_DISABLED=1')}, ${colors.cyan('DO_NOT_TRACK=1')}, ` +
        `or ${colors.cyan('--no-telemetry')}. Details: ${colors.underline(TELEMETRY_DOCS_URL)}`
    )
  }

  function start(): void {
    if (!consent.enabled) return

    printOptOutNoticeIfFirstRun()

    host.on('beforeExit', async () => {
      if (!tracked) {
        // Node takes an exit code written as a string ('0') as that number.
        if (Number(host.exitCode() ?? 0) === 0) {
          markCommandSuccess()
        } else {
          markCommandFailure()
        }
      }

      await telemetry.flush()
    })

    // A listener on 'uncaughtException' or 'unhandledRejection' suppresses the
    // default death, while the monitor form sees both and suppresses nothing.
    host.on('uncaughtExceptionMonitor', () => {
      markCommandFailure()

      // An 'uncaughtException' listener may keep the process alive, and then
      // the usual flush runs. With none, the default death follows this handler
      // at once and an async send would never leave, so it goes out now, bounded.
      if (host.listenerCount('uncaughtException') > 0) {
        void telemetry.flush()

        return
      }

      telemetry.flushSync(CRASH_FLUSH_TIMEOUT_MS)
    })
  }

  return {
    telemetry,
    getConsent: () => consent,
    getStatus,
    reset,
    noteBrowsers: (resolved) => {
      resolvedBrowsers = [...resolved]
    },
    noteInstallTarget: (target) => {
      installTarget = target
    },
    invokedCommand: () => invoked,
    resolveInvokedCommand: (nextArgv, valuedFlags) => {
      invoked = detectInvokedCommand(nextArgv, valuedFlags)
    },
    setConsent,
    markCommandSessionStart,
    markCommandSessionReady,
    hasTrackedSessionStart: () => sessionStarted,
    markCommandSuccess,
    markCommandFailure,
    reportCommandFailureNow,
    start
  }
}

// The CLI's own run, created and started when the entry point loads this.
export const telemetryCli = createTelemetryCli()
telemetryCli.start()

export const telemetry = telemetryCli.telemetry

export function getTelemetryConsent(): TelemetryConsent {
  return telemetryCli.getConsent()
}

export function getTelemetryStatus(): TelemetryStatus {
  return telemetryCli.getStatus()
}

// A row sent before this call, or by a run that never makes it, has no browser.
export function noteRunBrowsers(resolved: readonly string[]): void {
  telemetryCli.noteBrowsers(resolved)
}

export function resetTelemetry(): TelemetryReset {
  return telemetryCli.reset()
}

// The verb this run invoked, for the exit path that reports an outcome the
// command never got to mark itself.
export function invokedCommand(): string {
  return telemetryCli.invokedCommand()
}

// The first scan runs before any command registers its flags. Once they all
// have, the entry point resolves again with the flags that take a value.
export function resolveInvokedCommand(
  argv: string[],
  valuedFlags: ReadonlySet<string>
): void {
  telemetryCli.resolveInvokedCommand(argv, valuedFlags)
}

export function setTelemetryConsent(value: 'enabled' | 'disabled'): {
  ok: boolean
  path: string | null
} {
  return telemetryCli.setConsent(value)
}

export function markCommandSessionStart(command?: string): void {
  telemetryCli.markCommandSessionStart(command)
}

export function markCommandSessionReady(command?: string): void {
  telemetryCli.markCommandSessionReady(command)
}

export function hasTrackedSessionStart(): boolean {
  return telemetryCli.hasTrackedSessionStart()
}

export function markCommandSuccess(command?: string): void {
  telemetryCli.markCommandSuccess(command)
}

export function markCommandFailure(
  command?: string,
  details: CommandFailureDetails = {}
): void {
  telemetryCli.markCommandFailure(command, details)
}

export function reportCommandFailureNow(
  details: CommandFailureDetails = {}
): void {
  telemetryCli.reportCommandFailureNow(details)
}
