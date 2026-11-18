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
  compiler?: {close: (callback: () => void) => void}
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
  // A throw no step above owns. previousServing says whether the server the
  // restart began with was still untouched.
  onUnexpectedFailure: (
    error: unknown,
    state: {previousServing: boolean}
  ) => void
  // True once the session is being torn down, which owns the servers then.
  isShuttingDown: () => boolean
  fullReloadsDelivered: () => number
  reloadAfterRestart: (fullReloadsBefore: number) => Promise<unknown>
}

interface RestartState<Server extends RestartableServer> {
  // True until the server the restart began with is set aside.
  previousServing: boolean
  // The next bundle, from the old server set aside until it has started.
  unadopted: RestartBundle<Server> | null
  portHeld: boolean
}

// A restart builds the next compiler and server from the same session (ports,
// instance, broker, launched browser) and tears down only the bundler.
export function createSessionRestartHandler<Server extends RestartableServer>(
  steps: SessionRestartSteps<Server>
) {
  const restart = async (
    request: DevSessionRestartRequest,
    state: RestartState<Server>
  ): Promise<void> => {
    steps.announce(request)

    let nextBundle: RestartBundle<Server>

    try {
      nextBundle = await steps.createBundle()
    } catch (error) {
      // A session that is ending has said so, and reports nothing after it.
      if (steps.isShuttingDown()) return

      steps.onBundleFailure(error, request)

      return
    }

    // Shutdown stops the current server itself and frees the port for good.
    if (steps.isShuttingDown()) {
      discardRestartBundle(nextBundle)

      return
    }

    const previous = steps.currentServer()
    state.previousServing = false
    state.unadopted = nextBundle
    steps.setCurrentServer(null)

    state.portHeld = true
    steps.holdPort()

    if (previous && typeof previous.stop === 'function') {
      // A server that did not stop cleanly is still replaced: the session is
      // left with nothing serving only when the next one cannot start.
      try {
        await previous.stop()
      } catch (error) {
        if (!steps.isShuttingDown()) steps.onStopFailure(error)
      }
    }

    // Read once the old compiler is stopped, so only the new one's first
    // build can add to it before the reload below is decided.
    const fullReloadsBefore = steps.fullReloadsDelivered()

    if (steps.isShuttingDown()) {
      state.portHeld = false
      state.unadopted = null
      steps.endPortHold()
      discardRestartBundle(nextBundle)

      return
    }

    steps.setCurrentServer(nextBundle.server)

    try {
      await steps.startBundler(nextBundle.server)
    } catch (error) {
      state.unadopted = null

      // A start cut short by the shutdown is not a failure of the restart.
      if (steps.isShuttingDown()) return

      steps.setCurrentServer(null)
      await steps.onStartFailure(error, nextBundle.server)

      return
    } finally {
      state.portHeld = false
      steps.endPortHold()
    }

    state.unadopted = null

    const stats = await nextBundle.firstCompile

    // The bridge closes with the session, so no reload goes through it.
    if (steps.isShuttingDown()) return

    if (stats && typeof stats.hasErrors === 'function' && stats.hasErrors()) {
      return
    }

    // The fresh compiler's first build carries no changed sources, so the
    // classifier stays silent; the new entry set needs one full reload.
    await steps.reloadAfterRestart(fullReloadsBefore)
  }

  return async (request: DevSessionRestartRequest): Promise<void> => {
    const state: RestartState<Server> = {
      previousServing: true,
      unadopted: null,
      portHeld: false
    }

    try {
      await restart(request, state)
    } catch (error) {
      const {unadopted} = state
      state.unadopted = null

      if (state.portHeld) {
        state.portHeld = false
        steps.endPortHold()
      }

      if (steps.isShuttingDown()) {
        if (unadopted) discardRestartBundle(unadopted)

        return
      }

      // The old server is set aside and the next one never served, so the
      // session ends as it does when the next server cannot start.
      if (unadopted) {
        steps.setCurrentServer(null)

        try {
          await steps.onStartFailure(error, unadopted.server)
        } catch (failure) {
          steps.onUnexpectedFailure(failure, state)
        }

        return
      }

      steps.onUnexpectedFailure(error, state)
    }
  }
}

// A bundle that will never serve lets go of its compiler and of the manifest
// guard its server holds until stopped.
export function discardRestartBundle(bundle: {
  server: RestartableServer
  compiler?: {close: (callback: () => void) => void}
}): void {
  try {
    void Promise.resolve(bundle.server.stop?.()).catch(() => {})
  } catch {
    // Ignore
  }

  try {
    bundle.compiler?.close(() => {})
  } catch {
    // Ignore
  }
}

export interface RestartBundleBuild<Compiler, Bundle> {
  build: () => Promise<Bundle>
  activeCompiler: () => Compiler | null
  setActiveCompiler: (compiler: Compiler | null) => void
  // What a build that threw partway still holds, taken so it runs once.
  takeUnfinishedRelease: () => (() => void) | null
}

// A restart that cannot build its next bundle leaves the session exactly
// as it was: the serving compiler stays the one the middleware reads.
export async function buildRestartBundle<
  Compiler extends {close: (callback: () => void) => void},
  Bundle
>(steps: RestartBundleBuild<Compiler, Bundle>): Promise<Bundle> {
  const serving = steps.activeCompiler()

  try {
    return await steps.build()
  } catch (error) {
    const abandoned = steps.activeCompiler()
    steps.setActiveCompiler(serving)
    steps.takeUnfinishedRelease()?.()

    if (abandoned && abandoned !== serving) {
      try {
        abandoned.close(() => {})
      } catch {
        // Ignore
      }
    }

    throw error
  }
}
