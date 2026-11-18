// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {DevSessionRestartRequest} from './session-restart'

export interface RestartableServer {
  stop?: () => Promise<void>
}

export interface RestartBundle<Server extends RestartableServer> {
  server: Server
  firstCompile: Promise<{hasErrors?: () => boolean} | null>
}

export interface SessionRestartSteps<Server extends RestartableServer> {
  announce: (request: DevSessionRestartRequest) => void
  createBundle: () => Promise<RestartBundle<Server>>
  currentServer: () => Server | null
  setCurrentServer: (server: Server | null) => void
  holdPort: () => void
  endPortHold: () => void
  startBundler: (server: Server) => Promise<void>
  fullReloadsDelivered: () => number
  reloadAfterRestart: (fullReloadsBefore: number) => Promise<unknown>
}

// A restart builds the next compiler and server from the same session (ports,
// instance, broker, launched browser) and tears down only the bundler.
export function createSessionRestartHandler<Server extends RestartableServer>(
  steps: SessionRestartSteps<Server>
) {
  return async (request: DevSessionRestartRequest): Promise<void> => {
    steps.announce(request)
    const nextBundle = await steps.createBundle()
    const previous = steps.currentServer()
    steps.setCurrentServer(null)

    steps.holdPort()

    if (previous && typeof previous.stop === 'function') {
      await previous.stop()
    }

    // Read once the old compiler is stopped, so only the new one's first
    // build can add to it before the reload below is decided.
    const fullReloadsBefore = steps.fullReloadsDelivered()

    steps.setCurrentServer(nextBundle.server)

    try {
      await steps.startBundler(nextBundle.server)
    } finally {
      steps.endPortHold()
    }

    const stats = await nextBundle.firstCompile

    if (stats && typeof stats.hasErrors === 'function' && stats.hasErrors()) {
      return
    }

    // The fresh compiler's first build carries no changed sources, so the
    // classifier stays silent; the new entry set needs one full reload.
    await steps.reloadAfterRestart(fullReloadsBefore)
  }
}
