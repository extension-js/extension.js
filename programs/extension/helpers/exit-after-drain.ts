//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {telemetry} from './telemetry-cli'

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
 */
const TELEMETRY_FLUSH_TIMEOUT_MS = 500

// Node writes to a piped stdout/stderr asynchronously, so process.exit right
// after a large frame drops every byte past the first pipe buffer.
export async function exitAfterDrain(code: number): Promise<void> {
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
