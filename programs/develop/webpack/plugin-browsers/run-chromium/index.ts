import {type Compiler} from '@rspack/core'
import {createChromiumContext} from './chromium-context'
import {ChromiumLaunchPlugin} from './chromium-launch'
import {ChromiumUnifiedLoggerPlugin} from './chromium-logger'
import {ChromiumHardReloadPlugin} from './chromium-hard-reload'
import {ChromiumSourceInspectionPlugin} from './chromium-source-inspection'
import {
  LogContext,
  LogFormat,
  LogLevel,
  PluginInterface
} from '../browsers-types'
import type {DevOptions} from '../../webpack-types'

export class RunChromiumPlugin {
  readonly extension: string | string[]
  readonly browser: DevOptions['browser']
  readonly noOpen?: boolean
  readonly browserFlags?: string[]
  readonly excludeBrowserFlags?: string[]
  readonly profile?: string | false
  readonly preferences?: Record<string, any>
  readonly startingUrl?: string
  readonly autoReload?: boolean
  readonly stats?: boolean
  readonly chromiumBinary?: string
  readonly port?: string | number
  readonly instanceId?: string
  readonly source?: string
  readonly watchSource?: boolean
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
    // Path(s) to the extension(s) to load.
    // In our case, it's always 'dist/<browser>'
    this.extension = options.extension

    // Browser binary-related kung fu
    this.browser = options.browser
    this.startingUrl = options.startingUrl
    this.preferences = options.preferences
    this.profile = options.profile
    this.browserFlags = options.browserFlags
    this.excludeBrowserFlags = options.excludeBrowserFlags
    this.noOpen = options.noOpen

    // Supplementary browser binary path. Will
    // override the browser setting if provided.
    this.chromiumBinary = options.chromiumBinary

    // Instance/port coordination for remote
    // debugging and multi-instance runs
    this.instanceId = options.instanceId
    this.port = options.port

    // Source inspection (development mode):
    // For Chromium/Firefox: open a page and extract
    // full HTML (incl. content-script Shadow DOM)
    // Optional watch mode to re-print HTML on file changes
    this.source = options.source
    this.watchSource = options.watchSource

    // Unified logging for Chromium via CDP
    // (levels, contexts, formatting, timestamps, color)
    this.logLevel = options.logLevel
    this.logContexts = options.logContexts
    this.logFormat = options.logFormat
    this.logTimestamps = options.logTimestamps
    this.logColor = options.logColor
    this.logUrl = options.logUrl
    this.logTab = options.logTab

    // Dry run mode (no browser launch) for CI and diagnostics
    this.dryRun = options.dryRun
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
