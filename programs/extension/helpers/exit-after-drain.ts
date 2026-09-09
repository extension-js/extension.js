//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  invokedCommand,
  markCommandFailure,
  markCommandSuccess,
  telemetry
} from './telemetry-cli'

/* @invariant TELEMETRY IS FLUSHED HERE BECAUSE `process.exit` DOES NOT EMIT
 * `beforeExit`, AND THE ONLY FLUSH WE HAD LIVED IN A `beforeExit` HANDLER.
 *
 * `telemetry.track` queues; it does not send. `telemetry-cli` flushes from a
 * `beforeExit` listener, and Node deliberately does not emit that event when
 * the process ends through an explicit `process.exit`. Every command that ends
 * by calling this helper therefore queued its event and threw it away on the
 * way out.
 *
 * Measured 2026-07-30 over 180 days: `command_failed` had fired 95 times for
 * `build` and **ZERO times for `create`** across 4,305 create executions. Not
 * rare, zero, which is why six advertised template names could fail forever
 * without ever showing up as a failure. The events that did survive were the
 * ones from paths that fall off the end of the event loop naturally.
 *
 * The flush is bounded and swallowed. A telemetry endpoint that hangs must
 * never hold a CLI open, and an exit code is a promise to the caller that
 * outranks any measurement of ours.
 *
 * THE FLUSH ALONE DID NOT MAKE THAT GUARANTEE HOLD, AND THE MISSING HALF WAS
 * THE TRACKING CALL. `markCommandSuccess` runs after `parseAsync` resolves and
 * the `beforeExit` fallback runs when the loop empties, so a command that ends
 * its SUCCESS path here reached neither: control went back to the OS first.
 * This helper then drained an empty buffer and the run left no row at all.
 *
 * Counted in the local audit log on 2026-09-09, which `track` writes before any
 * sampling: 7,720 rows, and `doctor`, `publish`, `inspect`, `open`, `storage`,
 * `capabilities` and `telemetry` had zero between them, with `eval` at 6,
 * `logs` at 6 and `reload` at 1, all of those from a source build. Those ten
 * commands are the ones whose success path ends here. They were not unused,
 * they were unmeasurable, and PostHog reported them as never run by anybody.
 *
 * So the outcome is marked here, from the exit code the caller passed, before
 * the flush. The `tracked` guard keeps it a fallback: a command that already
 * knows its failure code marks first and this call does nothing. The exit code
 * is untouched, and a verb the CLI does not recognize is left alone rather
 * than counted into the `unknown` bucket as a success.
 */
const TELEMETRY_FLUSH_TIMEOUT_MS = 500

function markOutcomeForExit(code: number): void {
  // Swallowed like every other telemetry call: an exit code is a promise to
  // the caller, and a measurement must never be what breaks it.
  try {
    if (invokedCommand() === 'unknown') return
    if (code === 0) {
      markCommandSuccess()
      return
    }
    // No catalog code: the paths that know theirs pass it before they get
    // here, and inventing one would file a framed failure as internal.
    markCommandFailure(undefined, {exitCode: code})
  } catch {
    // Ignore
  }
}

// Node writes to a piped stdout/stderr asynchronously, so process.exit right
// after a large frame drops every byte past the first pipe buffer.
export async function exitAfterDrain(code: number): Promise<void> {
  // Before the flush, or the flush has nothing to send.
  markOutcomeForExit(code)

  try {
    await Promise.race([
      telemetry.flush(),
      new Promise<void>((resolve) =>
        setTimeout(resolve, TELEMETRY_FLUSH_TIMEOUT_MS).unref?.()
      )
    ])
  } catch {
    // A failed flush is never a reason to change the exit code.
  }

  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.writableLength === 0) return resolve()
          // An empty write's callback fires only after every queued byte
          // ahead of it has been handed to the OS.
          stream.write('', () => resolve())
        })
    )
  )

  process.exit(code)
}
