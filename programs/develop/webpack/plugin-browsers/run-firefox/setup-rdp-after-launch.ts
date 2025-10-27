import {Compilation} from '@rspack/core'
import {FirefoxRDPController} from './rdp-extension-controller'
import * as messages from '../browsers-lib/messages'

type PluginLike = {
  extension: string | string[]
  extensionsToLoad?: string[]
  browser: 'firefox'
  browserFlags?: string[]
  profile?: string | false
  preferences?: Record<string, unknown>
  startingUrl?: string
  geckoBinary?: string
  instanceId?: string
  source?: string | boolean
  watchSource?: boolean
  // logging flags
  logLevel?:
    | 'off'
    | 'error'
    | 'warn'
    | 'info'
    | 'debug'
    | 'trace'
    | 'all'
    | string
  logContexts?: Array<
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  >
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export async function setupRdpAfterLaunch(
  plugin: PluginLike & {[k: string]: unknown},
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

  const level = String(plugin.logLevel || '').toLowerCase()
  if (level && level !== 'off') {
    try {
      await controller.enableUnifiedLogging({
        level,
        contexts: plugin.logContexts,
        urlFilter: plugin.logUrl,
        tabFilter: plugin.logTab,
        format: plugin.logFormat || 'pretty',
        timestamps: plugin.logTimestamps !== false,
        color: plugin.logColor !== false
      })
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(messages.firefoxUnifiedLoggingFailed(String(error)))
      }
    }
  }
  return controller
}
