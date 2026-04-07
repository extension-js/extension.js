// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compiler} from '@rspack/core'
import {
  LogContext,
  LogFormat,
  LogLevel,
  type PluginInterface
} from '../browsers-types'
import type {DevOptions} from '../../webpack-types'
import {createFirefoxContext} from './firefox-context'
import {FirefoxLaunchPlugin} from './firefox-launch'
import {FirefoxUnifiedLoggerPlugin} from './firefox-unified-logger'
import {FirefoxHardReloadPlugin} from './firefox-hard-reload'
import {FirefoxSourceInspectionPlugin} from './firefox-source-inspection'
import {pickSharedBrowserRuntimeOptions} from '../browsers-lib/runtime-options'
import type {FirefoxRDPController} from './firefox-source-inspection/rdp-extension-controller'
import type {FirefoxPluginRuntime} from './firefox-types'

export class RunFirefoxPlugin implements FirefoxPluginRuntime {
  readonly extension!: string | string[]
  readonly browser!: DevOptions['browser']
  readonly noOpen?: boolean
  readonly browserFlags?: string[]
  readonly excludeBrowserFlags?: string[]
  readonly profile?: string | false
  readonly preferences?: Record<string, unknown>
  readonly startingUrl?: string
  readonly autoReload?: boolean
  readonly stats?: boolean
  readonly geckoBinary?: string
  readonly port?: number | string
  readonly instanceId?: string
  readonly source?: string | boolean
  readonly watchSource?: boolean
  readonly sourceFormat?: LogFormat
  readonly sourceSummary?: boolean
  readonly sourceMeta?: boolean
  readonly sourceProbe?: string[]
  readonly sourceTree?: 'off' | 'root-only'
  readonly sourceConsole?: boolean
  readonly sourceDom?: boolean
  readonly sourceMaxBytes?: number
  readonly sourceRedact?: 'off' | 'safe' | 'strict'
  readonly sourceIncludeShadow?: 'off' | 'open-only' | 'all'
  readonly sourceDiff?: boolean
  readonly dryRun?: boolean

  // Logger flags
  readonly logLevel?: LogLevel
  readonly logContexts?: Array<LogContext>
  readonly logFormat?: LogFormat
  readonly logTimestamps?: boolean
  readonly logColor?: boolean
  readonly logUrl?: string
  readonly logTab?: number | string
  logger!: ReturnType<Compiler['getInfrastructureLogger']>
  firefoxCtx?: ReturnType<typeof createFirefoxContext>
  rdpController?: FirefoxRDPController

  constructor(options: PluginInterface) {
    Object.assign(this, pickSharedBrowserRuntimeOptions(options))
    this.geckoBinary = options.geckoBinary
  }

  apply(compiler: Compiler) {
    // New plugin-based organization (no-op wiring for now)
    const ctx = createFirefoxContext()
    this.firefoxCtx = ctx

    // Launch Firefox after successful compilation
    new FirefoxLaunchPlugin(this, ctx).apply(compiler)

    // Allow users to inspect the page/extension
    // context source code via unified logging
    new FirefoxUnifiedLoggerPlugin(this, ctx).apply(compiler)

    // Handle hard reload flows (manifest/_locales + controller.hardReload)
    new FirefoxHardReloadPlugin(this, ctx).apply(compiler)

    // Stream logs / source inspection in development
    if (!this.dryRun) {
      new FirefoxSourceInspectionPlugin(this, ctx).apply(compiler)
    }
  }
}
