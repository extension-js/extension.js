// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {humanLine} from './lifecycle-stream'
import * as messages from './messages'

// How long after the auto-exit deadline the backstop waits at the earliest.
const FORCE_KILL_FLOOR_MS = 4000

// A backstop kill is a truncated session, never a completed one.
export const FORCE_KILL_EXIT_CODE = 1

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

  const autoExitMs = parseMilliseconds(autoExitMsRaw)

  if (autoExitMs === null) {
    return () => {}
  }

  try {
    humanLine(messages.autoExitModeEnabled(autoExitMs))
  } catch {
    // Ignore
  }

  autoExitTimer = setTimeout(async () => {
    try {
      humanLine(messages.autoExitTriggered(autoExitMs))
    } catch {
      // Ignore
    }

    await onCleanup()
  }, autoExitMs)

  const parsedForceKillMs = parseMilliseconds(forceKillMsRaw)
  // The force kill is the backstop for a teardown that already started, so it
  // is clamped later than the auto-exit deadline rather than read as absolute.
  const forceKillMs = Math.max(
    parsedForceKillMs ?? 0,
    autoExitMs + FORCE_KILL_FLOOR_MS
  )

  forceKillTimer = setTimeout(() => {
    try {
      humanLine(messages.autoExitForceKill(forceKillMs))
    } catch {
      // Ignore
    }

    // Reaching the backstop means the orderly path never finished, which a
    // caller cannot tell from a clean auto-exit unless the code differs.
    process.exit(FORCE_KILL_EXIT_CODE)
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
