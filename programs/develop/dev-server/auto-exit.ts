// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

  const autoExitMs = parseMilliseconds(autoExitMsRaw)
  if (autoExitMs === null) {
    return () => {}
  }

  try {
    console.log(messages.autoExitModeEnabled(autoExitMs))
  } catch {
    // Ignore
  }

  autoExitTimer = setTimeout(async () => {
    try {
      console.log(messages.autoExitTriggered(autoExitMs))
    } catch {
      // Ignore
    }
    await onCleanup()
  }, autoExitMs)

  const parsedForceKillMs = parseMilliseconds(forceKillMsRaw)
  const forceKillMs =
    parsedForceKillMs !== null && parsedForceKillMs > 0
      ? parsedForceKillMs
      : autoExitMs + 4000

  forceKillTimer = setTimeout(() => {
    try {
      console.log(messages.autoExitForceKill(forceKillMs))
    } catch {
      // Ignore
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
