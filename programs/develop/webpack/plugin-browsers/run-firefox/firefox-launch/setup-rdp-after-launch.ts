// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compilation} from '@rspack/core'
import {FirefoxRDPController} from '../firefox-source-inspection/rdp-extension-controller'
import type {FirefoxPluginLike, FirefoxPluginRuntime} from '../firefox-types'

export async function setupRdpAfterLaunch(
  plugin: FirefoxPluginRuntime & {[k: string]: unknown},
  compilation: Compilation,
  debugPort: number
): Promise<FirefoxRDPController> {
  const controller = new FirefoxRDPController(plugin, debugPort)

  const retry = async <T>(fn: () => Promise<T>, attempts = 5, baseMs = 150) => {
    let lastError: unknown

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          try {
            const msg = (error as Error)?.message || String(error)
            console.warn(
              `[plugin-browsers] Firefox RDP setup retry ${i + 1}/${attempts}: ${msg}`
            )
          } catch {
            // ignore
          }
        }
        const ms = baseMs * Math.pow(2, i)
        await new Promise((r) => setTimeout(r, ms))
      }
    }
    throw lastError
  }

  // Reuse controller if already connected to avoid duplicate connections
  if (!plugin.rdpController) {
    await retry(() => controller.ensureLoaded(compilation))
    plugin.rdpController = controller
  } else {
    // Ensure already-connected controller is ready
    await retry(
      () =>
        (plugin.rdpController as any).ensureLoaded?.(compilation) ||
        Promise.resolve()
    )
  }

  // Dev banner parity: print once after ensureLoaded
  // Unified logging is now enabled by FirefoxUnifiedLoggerPlugin
  return controller
}
