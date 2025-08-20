import * as messages from './messages'

function parseMilliseconds(value: string | number | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

export function setupAutoExit(
  autoExitMsRaw: string | number | undefined,
  forceKillMsRaw: string | number | undefined,
  onCleanup: () => Promise<void>
): () => void {
  let autoExitTimer: NodeJS.Timeout | null = null
  let forceKillTimer: NodeJS.Timeout | null = null

  // Determine the auto-exit timeout in ms
  const autoExitMs = parseMilliseconds(autoExitMsRaw)
  if (autoExitMs === null) {
    // Auto-exit not enabled; return a no-op cancel function
    return () => {}
  }

  // Log that auto-exit mode is enabled
  try {
    console.log(messages.autoExitModeEnabled(autoExitMs))
  } catch (err) {
    // Ignore logging errors
  }

  // Set up the timer for graceful exit
  autoExitTimer = setTimeout(async () => {
    try {
      console.log(messages.autoExitTriggered(autoExitMs))
    } catch (err) {
      // Ignore logging errors
    }
    await onCleanup()
  }, autoExitMs)

  // Determine the force-kill timeout in ms (defaults to 4s after auto-exit)
  const parsedForceKillMs = parseMilliseconds(forceKillMsRaw)
  const forceKillMs =
    parsedForceKillMs !== null && parsedForceKillMs > 0
      ? parsedForceKillMs
      : autoExitMs + 4000

  // Set up the timer for forced process exit
  forceKillTimer = setTimeout(() => {
    try {
      console.log(messages.autoExitForceKill(forceKillMs))
    } catch (err) {
      // Ignore logging errors
    }
    process.exit(0)
  }, forceKillMs)

  function cancelAutoExitTimers() {
    if (autoExitTimer !== null) {
      clearTimeout(autoExitTimer)
      autoExitTimer = null
    }
    if (forceKillTimer !== null) {
      clearTimeout(forceKillTimer)
      forceKillTimer = null
    }
  }

  return cancelAutoExitTimers
}
