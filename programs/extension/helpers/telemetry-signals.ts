//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {exitAfterDrain} from './exit-after-drain'
import {CODES} from './messaging'
import {
  getTelemetryConsent,
  hasTrackedSessionStart,
  markCommandFailure,
  telemetry
} from './telemetry-cli'

export type TerminationSignal = 'SIGINT' | 'SIGTERM'

export const TERMINATION_SIGNALS: readonly TerminationSignal[] = [
  'SIGINT',
  'SIGTERM'
]

/* @invariant CTRL-C IS THE NORMAL END OF EVERY LONG RUN, AND NODE RUNS NO
 * `beforeExit` FOR A SIGNAL DEATH, SO THE QUEUE LEFT WITH NOTHING.
 *
 * `exitAfterDrain` covers the paths that end in an explicit `process.exit`, and
 * `beforeExit` covers the ones that fall off the end of the event loop. A
 * signal is neither: the process is gone and the buffered event with it. That
 * is why a killed `dev` reported nothing and why `grep SIGINT` over this
 * package found teardown handlers for browsers and dev servers but not one
 * line about telemetry.
 *
 * WHY THIS HANDLER USUALLY DOES NOT EXIT THE PROCESS. `dev`, `start` and
 * `preview` install their own signal handlers, and those own the shutdown:
 * they terminate the browser child, close the dev server, and `run-only`
 * schedules a `process.exit(0)` ten milliseconds after the signal. Exiting from
 * here would race that teardown and cut it short for a measurement, which
 * inverts the priority. So the exit is taken only when nothing else is
 * listening, which is the case this handler created by registering at all: a
 * listener suppresses Node's default action, so a short command like `build`
 * would stop dying on Ctrl-C unless this puts the exit back. The code it exits
 * with is the one the shell would have reported, 128 plus the signal number.
 *
 * The flush is deadlined and swallowed for the same reason `exitAfterDrain`
 * deadlines its own: a slow or offline collector must never be the thing that
 * keeps a terminal from coming back.
 */
const FLUSH_DEADLINE_MS = 500

const SIGNAL_NUMBERS: Record<TerminationSignal, number> = {
  SIGINT: 2,
  SIGTERM: 15
}

export function signalExitCode(signal: TerminationSignal): number {
  return 128 + SIGNAL_NUMBERS[signal]
}

export interface TerminationSignalDeps {
  // The session-start event already counted this run, so a signal adds nothing.
  sessionStarted: () => boolean
  markInterrupted: (exitCode: number) => void
  flush: () => Promise<void>
  othersOwnTermination: () => boolean
  exit: (code: number) => void | Promise<void>
}

let handled = false
const ownListeners = new Set<() => void>()
let installed = false

export function __resetTelemetrySignalsForTest(): void {
  for (const signal of TERMINATION_SIGNALS) {
    for (const listener of ownListeners) {
      process.removeListener(signal, listener as never)
    }
  }
  ownListeners.clear()
  handled = false
  installed = false
}

// Exported so the deadline itself is testable: a collector that never answers
// must not be what keeps a terminal from coming back after Ctrl-C.
export async function flushTelemetryWithin(ms: number): Promise<void> {
  try {
    await Promise.race([
      telemetry.flush(),
      new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.())
    ])
  } catch {
    // Ignore
  }
}

export async function handleTerminationSignal(
  signal: TerminationSignal,
  deps: TerminationSignalDeps
): Promise<void> {
  // A SIGINT followed by a SIGTERM is one shutdown, not two outcomes.
  if (handled) return
  handled = true

  const counted = deps.sessionStarted()
  const othersOwn = deps.othersOwnTermination()

  /* A Ctrl-C is how a watch session normally ends, so calling every signal a
   * failure would rebuild the artifact this fix exists to remove. Only a run
   * that reported nothing and had no shutdown of its own is reported as
   * interrupted: `dev`, `start` and `preview` already counted themselves at
   * their session start, and `logs` ends through its own handler at exit 0.
   */
  if (!counted && !othersOwn) deps.markInterrupted(signalExitCode(signal))

  await deps.flush()

  // A session that came up ends the way it always has: exit 0 through whoever
  // owns the teardown. Only a run with no other listener needs this exit.
  if (!othersOwn) await deps.exit(counted ? 0 : signalExitCode(signal))
}

function defaultDeps(): TerminationSignalDeps {
  return {
    sessionStarted: hasTrackedSessionStart,
    markInterrupted: (exitCode) =>
      markCommandFailure(undefined, {code: CODES.E_INTERRUPTED, exitCode}),
    flush: () => flushTelemetryWithin(FLUSH_DEADLINE_MS),
    othersOwnTermination: () =>
      TERMINATION_SIGNALS.some((signal) =>
        process
          .listeners(signal)
          .some((listener) => !ownListeners.has(listener as () => void))
      ),
    exit: (code) => exitAfterDrain(code)
  }
}

// Registered from the CLI entry, before any command action runs, so this
// listener sees the signal ahead of the teardown handlers installed later.
export function installTelemetrySignalHandlers(): void {
  if (installed) return
  // An opted-out run installs nothing at all, so it keeps the exact signal
  // behavior it has today.
  if (!getTelemetryConsent().enabled) return
  installed = true

  for (const signal of TERMINATION_SIGNALS) {
    const listener = () => {
      void handleTerminationSignal(signal, defaultDeps())
    }
    ownListeners.add(listener)
    // `once`: a second Ctrl-C then finds no listener of ours and the default
    // action kills the process, so an interrupt is never swallowed twice.
    process.once(signal, listener)
  }
}
