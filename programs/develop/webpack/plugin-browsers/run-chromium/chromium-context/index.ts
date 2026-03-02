// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {CDPExtensionController} from '../chromium-source-inspection/cdp-extension-controller'

export type ChromiumContext = {
  // Controller lifecycle
  getController(): CDPExtensionController | undefined
  onControllerReady(cb: (c: CDPExtensionController, port: number) => void): void
  setController(c: CDPExtensionController, port: number): void

  // Aux state (extensible)
  getPorts(): {cdpPort?: number}
  getExtensionRoot(): string | undefined
  setExtensionRoot(root?: string): void

  // Reload helpers
  setServiceWorkerPaths(rel?: string, abs?: string): void
  getServiceWorkerPaths(): {relativePath?: string; absolutePath?: string}

  // Pending reload reason
  setPendingReloadReason(reason?: 'manifest' | 'locales' | 'sw'): void
  getPendingReloadReason(): 'manifest' | 'locales' | 'sw' | undefined
  clearPendingReloadReason(): void
}

export function createChromiumContext(): ChromiumContext {
  let controller: CDPExtensionController | undefined
  let cdpPort: number | undefined
  let extensionRoot: string | undefined
  let swRel: string | undefined
  let swAbs: string | undefined
  let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
  const readyCbs: Array<(c: CDPExtensionController, p: number) => void> = []

  return {
    getController: () => controller,
    onControllerReady: (cb) => {
      if (controller && cdpPort) cb(controller, cdpPort)
      else readyCbs.push(cb)
    },
    setController: (c, port) => {
      controller = c
      cdpPort = port
      for (const cb of readyCbs) cb(c, port)
      readyCbs.length = 0
    },

    getPorts: () => ({cdpPort}),
    getExtensionRoot: () => extensionRoot,
    setExtensionRoot: (root?: string) => {
      extensionRoot = root
    },

    setServiceWorkerPaths: (rel?: string, abs?: string) => {
      swRel = rel
      swAbs = abs
    },
    getServiceWorkerPaths: () => ({
      relativePath: swRel,
      absolutePath: swAbs
    }),

    setPendingReloadReason: (r) => {
      pendingReason = r
    },
    getPendingReloadReason: () => pendingReason,
    clearPendingReloadReason: () => {
      pendingReason = undefined
    }
  }
}
