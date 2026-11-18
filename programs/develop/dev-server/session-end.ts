// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ErrorCode} from '../lib/messaging'

// Ends one session as failed, and says false when it was already ending.
type EndAsFailed = (code: ErrorCode, message: string) => boolean

// The dev sessions running in this process by instance id, oldest first.
const liveSessions = new Map<string, EndAsFailed>()

export function registerLiveSession(
  instanceId: string,
  end: EndAsFailed
): () => void {
  liveSessions.set(instanceId, end)

  return () => {
    if (liveSessions.get(instanceId) === end) liveSessions.delete(instanceId)
  }
}

// Writes the failed frame, then each step that ends the session. True once
// the frame is out, and a step that throws does not skip the ones after it.
export function endAfterFrame(
  writeFrame: () => void,
  steps: Array<() => unknown>
): true {
  writeFrame()

  for (const step of steps) {
    try {
      const result = step()

      if (result instanceof Promise) result.catch(() => {})
    } catch {
      // The frame says the session ended, so the rest of it still goes.
    }
  }

  return true
}

// For a host that learns a session cannot go on: the named one, or the newest.
// False when it is not live, and the host then reports the failure itself.
export function endSessionAsFailed(
  code: ErrorCode,
  message: string,
  instanceId?: string
): boolean {
  const end =
    instanceId === undefined
      ? [...liveSessions.values()].pop()
      : liveSessions.get(instanceId)

  if (!end) return false

  try {
    return end(code, message)
  } catch {
    return false
  }
}
