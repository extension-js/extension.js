//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {exitAfterDrain} from './exit-after-drain'
import {usageRefusal} from './messages'
import {parseWholeNumber} from './normalize-options'

const POLL_INTERVAL_MS = 2_000

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 checks existence/permission without delivering; EPERM means the
    // pid exists under another user, still alive for watchdog purposes.
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

// With no live session nothing installed a cleanup a signal would run, so
// the run exits 1 itself and the parent reads an exit code, not a signal.
function exitAsParentGone(): void {
  void exitAfterDrain(1)
}

// Exit when the parent pid dies (--parent-pid): an orphaned dev otherwise races
// the next session's builds. Returns cancel.
export function setupParentWatchdog(
  parentPid: number,
  options?: {
    log?: (message: string) => void
    // Ends a live session through its engine, which writes the one terminal
    // frame. True when it did, and the frame and signal here are skipped.
    endSession?: () => boolean
    // The last thing a machine consumer sees, so it is written before the
    // shutdown that closes stdout behind it.
    emitFrame?: () => void
    // Replaces the exit 1 that ends a run with no live session.
    onDeath?: () => void
    pollIntervalMs?: number
    // Answers whether a pid is alive, the system probe when left out.
    isAlive?: (pid: number) => boolean
  }
): () => void {
  const log = options?.log ?? console.error
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS
  const isAlive = options?.isAlive ?? isProcessAlive
  const shutdown = options?.onDeath ?? exitAsParentGone

  const endedBySession = () => {
    try {
      return options?.endSession?.() === true
    } catch {
      return false
    }
  }

  const onParentDeath = () => {
    log(
      usageRefusal(
        `Parent process ${parentPid} is gone (--parent-pid). Shutting down.`
      )
    )

    if (endedBySession()) return

    options?.emitFrame?.()
    shutdown()
  }

  if (!isAlive(parentPid)) {
    onParentDeath()

    return () => {}
  }

  const timer = setInterval(() => {
    if (isAlive(parentPid)) return

    clearInterval(timer)
    onParentDeath()
  }, pollIntervalMs)
  // Polling must never keep an otherwise-finished process alive.
  timer.unref?.()

  return () => clearInterval(timer)
}

export function parseParentPid(value: unknown): number | undefined {
  const pid = parseWholeNumber(value)

  return pid !== undefined && pid > 0 ? pid : undefined
}
