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
import type {FirefoxRDPController} from './firefox-source-inspection/rdp-extension-controller'
import type {FirefoxPluginRuntime} from './firefox-types'

export class RunFirefoxPlugin implements FirefoxPluginRuntime {
  readonly extension: string | string[]
  readonly browser: DevOptions['browser']
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
  readonly keepProfileChanges?: boolean
  readonly copyFromProfile?: string
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
    this.geckoBinary = options.geckoBinary

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
    this.sourceFormat = options.sourceFormat
    this.sourceSummary = options.sourceSummary
    this.sourceMeta = options.sourceMeta
    this.sourceProbe = options.sourceProbe
    this.sourceTree = options.sourceTree
    this.sourceConsole = options.sourceConsole
    this.sourceDom = options.sourceDom
    this.sourceMaxBytes = options.sourceMaxBytes
    this.sourceRedact = options.sourceRedact
    this.sourceIncludeShadow = options.sourceIncludeShadow
    this.sourceDiff = options.sourceDiff

    // Unified logging flags
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
