import type {Compiler} from '@rspack/core'
import * as messages from '../../browsers-lib/messages'
import type {FirefoxContext} from '../firefox-context'

/**
 * FirefoxUnifiedLoggerPlugin
 *
 * Responsibilities:
 * - Wait for RDP controller readiness; enable unified logging
 * - Respect level/contexts/filters/format/timestamps/color
 */
export class FirefoxUnifiedLoggerPlugin {
  private readonly options: {
    logLevel?: string
    logContexts?: string[]
    logUrl?: string
    logTab?: number | string
    logFormat?: 'pretty' | 'json' | 'ndjson'
    logTimestamps?: boolean
    logColor?: boolean
  }
  private readonly ctx: FirefoxContext

  constructor(
    options: FirefoxUnifiedLoggerPlugin['options'],
    ctx: FirefoxContext
  ) {
    this.options = options
    this.ctx = ctx
  }

  apply(_compiler: Compiler) {
    const lvl = String(this.options?.logLevel || '').toLowerCase()
    if (!lvl || lvl === 'off') return

    this.ctx.onControllerReady(async (controller) => {
      try {
        await (controller as any).enableUnifiedLogging({
          level: this.options?.logLevel,
          contexts: this.options?.logContexts,
          urlFilter: this.options?.logUrl,
          tabFilter: this.options?.logTab,
          format: this.options?.logFormat || 'pretty',
          timestamps: this.options?.logTimestamps !== false,
          color: this.options?.logColor !== false
        })
      } catch (error) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          this.ctx.logger?.warn?.(
            messages.firefoxUnifiedLoggingFailed(String(error))
          )
        }
      }
    })
  }
}
