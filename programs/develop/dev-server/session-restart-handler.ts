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
  // The next compiler could not be built. The current server was not touched.
  onBundleFailure: (error: unknown, request: DevSessionRestartRequest) => void
  onStopFailure: (error: unknown) => void
  // The next server could not start after the old one stopped.
  onStartFailure: (error: unknown, server: Server) => void | Promise<void>
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

    let nextBundle: RestartBundle<Server>

    try {
      nextBundle = await steps.createBundle()
    } catch (error) {
      steps.onBundleFailure(error, request)

      return
    }

    const previous = steps.currentServer()
    steps.setCurrentServer(null)

    steps.holdPort()

    if (previous && typeof previous.stop === 'function') {
      // A server that did not stop cleanly is still replaced: the session is
      // left with nothing serving only when the next one cannot start.
      try {
        await previous.stop()
      } catch (error) {
        steps.onStopFailure(error)
      }
    }

    // Read once the old compiler is stopped, so only the new one's first
    // build can add to it before the reload below is decided.
    const fullReloadsBefore = steps.fullReloadsDelivered()

    steps.setCurrentServer(nextBundle.server)

    try {
      await steps.startBundler(nextBundle.server)
    } catch (error) {
      steps.setCurrentServer(null)
      await steps.onStartFailure(error, nextBundle.server)

      return
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
