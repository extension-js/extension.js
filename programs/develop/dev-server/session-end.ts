// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ErrorCode} from '../lib/messaging'

type EndAsFailed = (code: ErrorCode, message: string) => void

// The dev sessions running in this process, by what ends each as a failure.
const liveSessions = new Set<EndAsFailed>()

export function registerLiveSession(end: EndAsFailed): () => void {
  liveSessions.add(end)

  return () => {
    liveSessions.delete(end)
  }
}

// For a host that learns the session cannot go on: each live session writes
// its one terminal failed frame, then shuts down and exits 1. False when no
// session is live yet, and the host then reports the failure itself.
export function endSessionAsFailed(code: ErrorCode, message: string): boolean {
  if (liveSessions.size === 0) return false

  for (const end of [...liveSessions]) {
    try {
      end(code, message)
    } catch {
      // Ignore
    }
  }

  return true
}
