// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  answerSessionRestarts,
  type DevSessionRestartRequest
} from '../lib/session-restart-signal'

export type {DevSessionRestartRequest} from '../lib/session-restart-signal'

export const DEV_SESSION_RESTART_DEBOUNCE_MS = 300

type RestartHandler = (
  request: DevSessionRestartRequest
) => void | Promise<void>

type RestartFailureHandler = (
  error: unknown,
  request: DevSessionRestartRequest
) => void

export class DevSessionRestartScheduler {
  private readonly debounceMs: number
  private handler: RestartHandler | null = null
  private failureHandler: RestartFailureHandler | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private latest: DevSessionRestartRequest | null = null
  private inFlight = false

  constructor(debounceMs = DEV_SESSION_RESTART_DEBOUNCE_MS) {
    this.debounceMs = Math.max(0, debounceMs)
  }

  setHandler(handler: RestartHandler | null): void {
    this.handler = handler
  }

  // Told about a restart that threw, so no failure ends here unseen.
  setFailureHandler(handler: RestartFailureHandler | null): void {
    this.failureHandler = handler
  }

  // The newest request wins; a request that lands while a restart is running
  // is kept and served by one more restart once the current one settles.
  request(request: DevSessionRestartRequest): void {
    this.latest = request
    if (this.inFlight) return

    this.schedule()
  }

  // A request waiting behind the restart that is running, or for its timer.
  hasQueuedRequest(): boolean {
    return this.latest != null
  }

  isPending(): boolean {
    return this.latest != null || this.inFlight
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)

    this.timer = undefined
    this.latest = null
    this.handler = null
    this.failureHandler = null
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)

    if (this.debounceMs === 0) {
      void this.flush()

      return
    }

    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.debounceMs)

    this.timer.unref?.()
  }

  private async flush(): Promise<void> {
    if (this.inFlight) return

    const request = this.latest
    const handler = this.handler
    if (!request || !handler) return

    this.latest = null
    this.inFlight = true

    try {
      await handler(request)
    } catch (error) {
      try {
        this.failureHandler?.(error, request)
      } catch {
        // Best-effort: a report that throws must not stop the next restart.
      }
    } finally {
      this.inFlight = false
      if (this.latest) this.schedule()
    }
  }
}

// The newest live session, which takes a request no compiler is named for.
let boundScheduler: DevSessionRestartScheduler | null = null

// Every live session of this host, oldest first.
const boundSchedulers = new Set<DevSessionRestartScheduler>()

// The session each compiler was built for, so its request reaches its own.
const schedulerByCompiler = new WeakMap<object, DevSessionRestartScheduler>()

// Compilers that will not serve again. A WeakSet, so they are not kept.
const retiredCompilers = new WeakSet<object>()

// Compilers whose next build a restart will supersede. Their diagnostics
// about entries the old include list could not emit are noise.
const restartingCompilers = new WeakSet<object>()

export function bindDevSessionRestart(
  scheduler: DevSessionRestartScheduler
): void {
  boundSchedulers.delete(scheduler)
  boundSchedulers.add(scheduler)
  boundScheduler = scheduler
}

export function assignCompilerToDevSession(
  compiler: object,
  scheduler: DevSessionRestartScheduler
): void {
  retiredCompilers.delete(compiler)
  schedulerByCompiler.set(compiler, scheduler)
}

// A compiler that will not serve again, replaced or never adopted, has no
// session left: what it still asks reaches no other session of the host.
export function releaseCompilerFromDevSession(
  compiler: object | undefined
): void {
  if (!compiler) return

  schedulerByCompiler.delete(compiler)
  retiredCompilers.add(compiler)
}

// The live session a compiler speaks for. One that names no known compiler
// speaks for the newest session.
function liveSessionOf(
  compiler: object | undefined
): DevSessionRestartScheduler | null {
  if (!compiler) return boundScheduler
  if (retiredCompilers.has(compiler)) return null

  const own = schedulerByCompiler.get(compiler)

  // A compiler whose session ended, or is not bound yet, has none.
  if (own) return boundSchedulers.has(own) ? own : null

  return boundScheduler
}

// A session passes its own scheduler and unbinds only that one: the other
// sessions of the same host go on restarting.
export function unbindDevSessionRestart(
  scheduler?: DevSessionRestartScheduler
): void {
  if (!scheduler) {
    boundSchedulers.clear()
    boundScheduler = null

    return
  }

  boundSchedulers.delete(scheduler)

  if (boundScheduler === scheduler) {
    boundScheduler = [...boundSchedulers].pop() ?? null
  }
}

// Asked for the session the compiler belongs to, so another live session
// of the host does not answer for one that is not bound yet.
export function canAutoRestartDevSession(compiler?: object): boolean {
  return liveSessionOf(compiler) != null
}

// True when a live session will carry the change; a false return means the
// caller must still surface its restart-required diagnostic.
export function requestDevSessionRestart(
  compiler: object | undefined,
  request: DevSessionRestartRequest
): boolean {
  const scheduler = liveSessionOf(compiler)

  if (!scheduler) return false
  if (compiler) restartingCompilers.add(compiler)

  scheduler.request(request)

  return true
}

// The restart each serving compiler asks for again on its next change.
const retryByCompiler = new WeakMap<object, DevSessionRestartRequest>()
const retryTapped = new WeakSet<object>()

interface WatchingCompiler {
  hooks?: {watchRun?: {tap?: (name: string, fn: () => void) => void}}
}

// The next change the serving compiler sees asks for the failed restart
// again, unless a newer request is already in line to take its place.
function retryOnNextChange(
  compiler: object,
  request: DevSessionRestartRequest
): void {
  retryByCompiler.set(compiler, request)

  if (retryTapped.has(compiler)) return

  const watchRun = (compiler as WatchingCompiler).hooks?.watchRun
  if (typeof watchRun?.tap !== 'function') return

  retryTapped.add(compiler)
  watchRun.tap('extjs-session-restart-retry', () => {
    const retry = retryByCompiler.get(compiler)
    if (!retry) return

    retryByCompiler.delete(compiler)

    if (liveSessionOf(compiler)?.hasQueuedRequest()) return

    requestDevSessionRestart(compiler, retry)
  })
}

// A restart that could not build its next compiler leaves this one serving,
// so it reports its own diagnostics again and retries on the next change.
export function endCompilerRestart(
  compiler: object | undefined,
  retry?: DevSessionRestartRequest
): void {
  if (!compiler) return

  restartingCompilers.delete(compiler)
  if (retry) retryOnNextChange(compiler, retry)
}

export function isCompilerRestarting(compiler: object | undefined): boolean {
  return compiler != null && restartingCompilers.has(compiler)
}

// True while a restart is queued or running. One that failed can leave
// another in line, which a caller must not take for a restart given up on.
export function isDevSessionRestartPending(compiler?: object): boolean {
  return liveSessionOf(compiler)?.isPending() ?? false
}

// Every plugin asks through the signal in lib, and this module answers it
// for the sessions it holds.
answerSessionRestarts({
  request: requestDevSessionRestart,
  isRestarting: isCompilerRestarting
})
