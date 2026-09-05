// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// A manifest entrypoint added mid-watch (a second content script, a toolbar
// icon, a new page) is outside the include list the running compiler was
// built with, so HMR cannot carry it. The plugins that notice such a change
// ask the session to restart itself; the dev server, which outlives the
// compiler being torn down, performs one restart for a burst of saves.

export type DevSessionRestartReason = 'scripts' | 'html' | 'icons' | 'json'

export interface DevSessionRestartRequest {
  reason: DevSessionRestartReason
  pathAfter?: string
  pathBefore?: string
  manifestField?: string
}

export const DEV_SESSION_RESTART_DEBOUNCE_MS = 300

type RestartHandler = (
  request: DevSessionRestartRequest
) => void | Promise<void>

export class DevSessionRestartScheduler {
  private readonly debounceMs: number
  private handler: RestartHandler | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private latest: DevSessionRestartRequest | null = null
  private inFlight = false

  constructor(debounceMs = DEV_SESSION_RESTART_DEBOUNCE_MS) {
    this.debounceMs = Math.max(0, debounceMs)
  }

  setHandler(handler: RestartHandler | null): void {
    this.handler = handler
  }

  // The newest request wins; a request that lands while a restart is running
  // is kept and served by one more restart once the current one settles.
  request(request: DevSessionRestartRequest): void {
    this.latest = request
    if (this.inFlight) return
    this.schedule()
  }

  isPending(): boolean {
    return this.latest != null || this.inFlight
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.latest = null
    this.handler = null
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
    } catch {
      // The handler reports its own failure; the session keeps serving.
    } finally {
      this.inFlight = false
      if (this.latest) this.schedule()
    }
  }
}

let boundScheduler: DevSessionRestartScheduler | null = null

// Compilers whose next build a restart will supersede. Their diagnostics
// about entries the old include list could not emit are noise.
const restartingCompilers = new WeakSet<object>()

export function bindDevSessionRestart(
  scheduler: DevSessionRestartScheduler
): void {
  boundScheduler = scheduler
}

export function unbindDevSessionRestart(): void {
  boundScheduler = null
}

export function canAutoRestartDevSession(): boolean {
  return boundScheduler != null
}

// True when a live session will carry the change; a false return means the
// caller must still surface its restart-required diagnostic.
export function requestDevSessionRestart(
  compiler: object | undefined,
  request: DevSessionRestartRequest
): boolean {
  if (!boundScheduler) return false
  if (compiler) restartingCompilers.add(compiler)
  boundScheduler.request(request)
  return true
}

export function isCompilerRestarting(compiler: object | undefined): boolean {
  return compiler != null && restartingCompilers.has(compiler)
}
