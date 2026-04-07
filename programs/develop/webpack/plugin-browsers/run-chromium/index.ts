// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compiler} from '@rspack/core'
import {createChromiumContext} from './chromium-context'
import {ChromiumLaunchPlugin} from './chromium-launch'
import {ChromiumUnifiedLoggerPlugin} from './chromium-unified-logger'
import {ChromiumHardReloadPlugin} from './chromium-hard-reload'
import {ChromiumSourceInspectionPlugin} from './chromium-source-inspection'
import {pickSharedBrowserRuntimeOptions} from '../browsers-lib/runtime-options'
import {
  LogContext,
  LogFormat,
  LogLevel,
  PluginInterface
} from '../browsers-types'
import type {DevOptions} from '../../webpack-types'

export class RunChromiumPlugin {
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
  readonly chromiumBinary?: string
  readonly port?: string | number
  readonly instanceId?: string
  readonly source?: string
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
  chromiumCtx?: ReturnType<typeof createChromiumContext>

  constructor(options: PluginInterface) {
    Object.assign(this, pickSharedBrowserRuntimeOptions(options))
    this.chromiumBinary = options.chromiumBinary
  }

  apply(compiler: Compiler) {
    // New plugin-based organization (no-op wiring for now)
    const ctx = createChromiumContext()
    this.chromiumCtx = ctx

    // Handle all command line flags we pass down to
    // Chromium, including user profiles
    new ChromiumLaunchPlugin(this, ctx).apply(compiler)

    // Allow users to inspect the page/extension
    // context source code
    new ChromiumUnifiedLoggerPlugin(this, ctx).apply(compiler)

    // Handle hard reloads of the extension
    // (Service Worker/Manifest/_locales changes)
    new ChromiumHardReloadPlugin(this, ctx).apply(compiler)

    // Stream logs to the console in real-time
    // (unified logging for Chromium via CDP)
    if (!this.dryRun) {
      new ChromiumSourceInspectionPlugin(this, ctx).apply(compiler)
    }
  }
}
