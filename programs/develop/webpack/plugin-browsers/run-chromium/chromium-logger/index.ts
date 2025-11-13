import type {Compiler} from '@rspack/core'
import type {ChromiumContext} from '../chromium-context'
import {setupUnifiedLogging} from './unified-logging'

/**
 * ChromiumUnifiedLoggerPlugin
 *
 * Intended responsibilities:
 * - Wait for controller readiness; enable unified CDP logging
 * - Respect level/contexts/filters/format/timestamps/color
 */
export class ChromiumUnifiedLoggerPlugin {
  constructor(
    private readonly options: any,
    private readonly ctx: ChromiumContext
  ) {
    // Wiring will be introduced in a follow-up edit.
  }

  apply(_compiler: Compiler) {
    this.ctx.onControllerReady(async (controller) => {
      try {
        await setupUnifiedLogging(controller, {
          level: this.options?.logLevel,
          contexts: this.options?.logContexts,
          urlFilter: this.options?.logUrl,
          tabFilter: this.options?.logTab,
          format: this.options?.logFormat,
          timestamps: this.options?.logTimestamps !== false,
          color: this.options?.logColor !== false
        })
      } catch {
        // best-effort
      }
    })
  }
}
