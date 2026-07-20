//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const POLL_INTERVAL_MS = 2_000
const HARD_EXIT_GRACE_MS = 5_000

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the existence/permission check without delivering
    // anything. EPERM means the pid exists but belongs to another user,
    // still alive for watchdog purposes.
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/**
 * Exit this process when the given parent pid dies (`--parent-pid`).
 *
 * Wrappers that spawn `extension dev` otherwise have to own the whole
 * process group to guarantee teardown; when a wrapper dies HARD (SIGKILL,
 * crash, CI reaper), the orphaned dev keeps watching and compiling, and the
 * next session's builds race it inside one dist. Watching the parent pid
 * directly closes that hole: on death we deliver SIGTERM to ourselves so the
 * regular cleanup handlers (dev server stop, port manager, browser plugins)
 * run, with a hard exit as backstop.
 *
 * Returns a cancel function.
 */
export function setupParentWatchdog(
  parentPid: number,
  options?: {
    log?: (message: string) => void
    // Test seam: replaces the SIGTERM-self shutdown.
    onDeath?: () => void
    pollIntervalMs?: number
  }
): () => void {
  const log = options?.log ?? console.error
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS
  const shutdown =
    options?.onDeath ??
    (() => {
      // Backstop first: if the graceful path wedges, still exit.
      const hardExit = setTimeout(() => process.exit(1), HARD_EXIT_GRACE_MS)
      hardExit.unref?.()
      try {
        process.kill(process.pid, 'SIGTERM')
      } catch {
        process.exit(1)
      }
    })

  const onParentDeath = () => {
    log(
      `[Extension.js] Parent process ${parentPid} is gone (--parent-pid). Shutting down.`
    )
    shutdown()
  }

  if (!isProcessAlive(parentPid)) {
    onParentDeath()
    return () => {}
  }

  const timer = setInterval(() => {
    if (isProcessAlive(parentPid)) return
    clearInterval(timer)
    onParentDeath()
  }, pollIntervalMs)
  // Polling must never keep an otherwise-finished process alive.
  timer.unref?.()

  return () => clearInterval(timer)
}

export function parseParentPid(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const pid = Number.parseInt(String(value), 10)
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  return pid
}
