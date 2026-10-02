// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {humanLine} from './lifecycle-stream'
import * as messages from './messages'

// How long after the auto-exit deadline the default backstop waits.
const FORCE_KILL_DEFAULT_GRACE_MS = 4000

// A backstop that cuts a teardown short is a truncated session, never a
// completed one.
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
  let teardownStarted = false

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

    teardownStarted = true
    await onCleanup()
  }, autoExitMs)

  // An explicit value is absolute from session start, so one set below the
  // auto-exit deadline stays the shorter knob it always was.
  const forceKillMs =
    parseMilliseconds(forceKillMsRaw) ??
    autoExitMs + FORCE_KILL_DEFAULT_GRACE_MS

  forceKillTimer = setTimeout(() => {
    try {
      humanLine(messages.autoExitForceKill(forceKillMs))
    } catch {
      // Ignore
    }

    // Firing over a teardown that never finished is a failure the caller must
    // see. Firing before auto-exit is the hard stop the caller asked for.
    process.exit(teardownStarted ? FORCE_KILL_EXIT_CODE : 0)
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
