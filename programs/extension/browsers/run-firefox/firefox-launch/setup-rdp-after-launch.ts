// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {CompilationLike} from '../../browsers-types'
import type {FirefoxPluginRuntime} from '../firefox-types'
import {FirefoxRDPController} from '../rdp/rdp-extension-controller'

export async function setupRdpAfterLaunch(
  plugin: FirefoxPluginRuntime & {[k: string]: unknown},
  compilation: CompilationLike,
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
              `[browser] Firefox RDP setup retry ${i + 1}/${attempts}: ${msg}`
            )
          } catch {}
        }
        const ms = baseMs * 2 ** i
        await new Promise((r) => setTimeout(r, ms))
      }
    }
    throw lastError
  }

  if (!plugin.rdpController) {
    await retry(() => controller.ensureLoaded(compilation))
    plugin.rdpController = controller
  } else {
    await retry(
      () =>
        (
          plugin.rdpController as {
            ensureLoaded?: (compilation: CompilationLike) => Promise<void>
          }
        ).ensureLoaded?.(compilation) || Promise.resolve()
    )
  }

  return controller
}
