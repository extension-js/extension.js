// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {FirefoxRDPController} from '../firefox-source-inspection/rdp-extension-controller'

export type PendingReason = 'manifest' | 'locales' | 'sw'

export type FirefoxContext = {
  // Controller lifecycle (parity with Chromium context)
  getController(): FirefoxRDPController | undefined
  onControllerReady(cb: (c: FirefoxRDPController, port: number) => void): void
  setController(c: FirefoxRDPController, port: number): void

  // Aux state
  getPorts(): {rdpPort?: number}

  // Extension metadata parity
  setExtensionRoot(root?: string): void
  getExtensionRoot(): string | undefined

  // Service worker paths (relative/absolute)
  setServiceWorkerPaths(rel?: string, abs?: string): void
  getServiceWorkerPaths(): {relativePath?: string; absolutePath?: string}

  // Reload reason tracking
  setPendingReloadReason(reason?: PendingReason): void
  getPendingReloadReason(): PendingReason | undefined
  clearPendingReloadReason(): void

  // Logging / reload info
  logger?: ReturnType<Compiler['getInfrastructureLogger']>
  didLaunch?: boolean
}

export function createFirefoxContext(): FirefoxContext {
  let controller: FirefoxRDPController | undefined
  let rdpPort: number | undefined
  const readyCbs: Array<(c: FirefoxRDPController, p: number) => void> = []

  let extensionRoot: string | undefined
  let swRel: string | undefined
  let swAbs: string | undefined
  let pendingReason: PendingReason | undefined

  return {
    getController: () => controller,
    onControllerReady: (cb) => {
      if (controller && rdpPort) cb(controller, rdpPort)
      else readyCbs.push(cb)
    },
    setController: (c, port) => {
      controller = c
      rdpPort = port
      for (const cb of readyCbs) cb(c, port)
      readyCbs.length = 0
    },

    getPorts: () => ({rdpPort}),

    setExtensionRoot: (root?: string) => {
      extensionRoot = root
    },
    getExtensionRoot: () => extensionRoot,

    setServiceWorkerPaths: (rel?: string, abs?: string) => {
      swRel = rel
      swAbs = abs
    },
    getServiceWorkerPaths: () => ({relativePath: swRel, absolutePath: swAbs}),

    setPendingReloadReason: (r?: PendingReason) => {
      pendingReason = r
    },
    getPendingReloadReason: () => pendingReason,
    clearPendingReloadReason: () => {
      pendingReason = undefined
    },

    logger: undefined,
    didLaunch: false
  }
}
