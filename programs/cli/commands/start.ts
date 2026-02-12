//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import {createRequire} from 'module'
import * as messages from '../cli-lib/messages'
import {commandDescriptions} from '../cli-lib/messages'
import {
  vendors,
  validateVendorsOrExit,
  type Browser,
  parseOptionalBoolean
} from '../utils'
import {
  normalizeSourceFormatOption,
  normalizeSourceIncludeShadowOption,
  normalizeSourceMaxBytesOption,
  normalizeSourceOption,
  normalizeSourceRedactOption,
  normalizeSourceMetaOption,
  normalizeSourceProbeOption,
  normalizeSourceTreeOption,
  normalizeSourceConsoleOption,
  normalizeSourceDomOption,
  normalizeSourceDiffOption,
  parseExtensionsList,
  parseLogContexts
} from '../utils/normalize-options'

type StartOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
  polyfill?: boolean | string
  install?: boolean
  runner?: boolean
  // Internal maintainer flags
  author?: boolean
  authorMode?: boolean
  // Source inspection (parity with dev/preview)
  source?: boolean | string
  watchSource?: boolean
  sourceFormat?: 'pretty' | 'json' | 'ndjson'
  sourceSummary?: boolean
  sourceMeta?: boolean
  sourceProbe?: string | string[]
  sourceTree?: 'off' | 'root-only'
  sourceConsole?: boolean
  sourceDom?: boolean
  sourceMaxBytes?: number | string
  sourceRedact?: 'off' | 'safe' | 'strict'
  sourceIncludeShadow?: 'off' | 'open-only' | 'all'
  sourceDiff?: boolean | string
  // Unified logger options (parity with dev/preview)
  logLevel?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  extensions?: string
}

const require = createRequire(import.meta.url)

export function registerStartCommand(program: Command, telemetry: any) {
  program
    .command('start')
    .arguments('[project-path|remote-url]')
    .usage('start [project-path|remote-url] [options]')
    .description(commandDescriptions.start)
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      '--browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based>',
      'specify a browser/engine to run. Defaults to `chromium`'
    )
    .option(
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `true`'
    )
    .option(
      '--chromium-binary <path-to-binary>',
      'specify a path to the Chromium binary. This option overrides the --browser setting. Defaults to the system default'
    )
    .option(
      '--gecko-binary, --firefox-binary <path-to-binary>',
      'specify a path to the Gecko binary. This option overrides the --browser setting. Defaults to the system default'
    )
    .option(
      '--starting-url <url>',
      'specify the starting URL for the browser. Defaults to `undefined`'
    )
    .option(
      '--no-runner',
      'do not launch the browser runner (build still runs)'
    )
    .option(
      '--port <port>',
      'specify the port to use for the development server. Defaults to `8080`'
    )
    .option(
      '--log-context <list>',
      '[experimental] comma-separated contexts to include (background,content,page,sidebar,popup,options,devtools). Use `all` to include all contexts (default)'
    )
    .option(
      '--logs <off|error|warn|info|debug|trace|all>',
      '[experimental] minimum centralized logger level to display in terminal (default: off)'
    )
    .option(
      '--log-format <pretty|json|ndjson>',
      '[experimental] output format for logger events. Defaults to `pretty`'
    )
    .option('--no-log-timestamps', 'disable ISO timestamps in pretty output')
    .option('--no-log-color', 'disable color in pretty output')
    .option(
      '--log-url <pattern>',
      '[experimental] only show logs where event.url matches this substring or regex (/re/i)'
    )
    .option('--log-tab <id>', 'only show logs for a specific tabId (number)')
    .option(
      '--source [url]',
      '[experimental] opens the provided URL in Chrome and prints the full, live HTML of the page after content scripts are injected'
    )
    .option(
      '--watch-source [boolean]',
      '[experimental] re-print HTML on rebuilds or file changes',
      parseOptionalBoolean
    )
    .option(
      '--source-format <pretty|json|ndjson>',
      '[experimental] output format for source HTML (defaults to --log-format when present, otherwise JSON when --source is used)'
    )
    .option(
      '--source-summary [boolean]',
      '[experimental] output a compact summary instead of full HTML',
      parseOptionalBoolean
    )
    .option(
      '--source-meta [boolean]',
      '[experimental] output page metadata (readyState, viewport, frames)',
      parseOptionalBoolean
    )
    .option(
      '--source-probe <selectors>',
      '[experimental] comma-separated CSS selectors to probe'
    )
    .option(
      '--source-tree <off|root-only>',
      '[experimental] output a compact extension root tree'
    )
    .option(
      '--source-console [boolean]',
      '[experimental] output console summary (best-effort)',
      parseOptionalBoolean
    )
    .option(
      '--source-dom [boolean]',
      '[experimental] output DOM snapshots and diffs (default: true when watch is enabled)',
      parseOptionalBoolean
    )
    .option(
      '--source-max-bytes <bytes>',
      '[experimental] limit HTML output size in bytes (0 disables truncation)'
    )
    .option(
      '--source-redact <off|safe|strict>',
      '[experimental] redact sensitive content in HTML output (default: safe for JSON/NDJSON)'
    )
    .option(
      '--source-include-shadow <off|open-only|all>',
      '[experimental] control Shadow DOM inclusion in HTML output (default: open-only)'
    )
    .option(
      '--source-diff [boolean]',
      '[experimental] include diff metadata on watch updates (default: true when watch is enabled)',
      parseOptionalBoolean
    )
    .option(
      '--extensions <list>',
      'comma-separated list of companion extensions or store URLs to load'
    )
    .option(
      '--install [boolean]',
      '[experimental] install project dependencies when missing',
      parseOptionalBoolean
    )
    .option(
      '--author, --author-mode',
      '[experimental] enable maintainer diagnostics (does not affect user runtime logs)'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...startOptions}: StartOptions
    ) {
      if (startOptions.author || startOptions.authorMode) {
        process.env.EXTENSION_AUTHOR_MODE = 'true'
        if (!process.env.EXTENSION_VERBOSE) process.env.EXTENSION_VERBOSE = '1'
      }

      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'start',
        vendors: vendors(browser),
        polyfill_used: startOptions.polyfill?.toString() !== 'false'
      })

      const list = vendors(browser)
      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      const normalizedSource = normalizeSourceOption(
        startOptions.source,
        startOptions.startingUrl
      )

      if (normalizedSource) {
        startOptions.source = normalizedSource
      }

      const sourceEnabled = Boolean(
        startOptions.source || startOptions.watchSource
      )

      const normalizedSourceFormat = normalizeSourceFormatOption({
        sourceFormat: startOptions.sourceFormat,
        logFormat: startOptions.logFormat,
        sourceEnabled
      })

      startOptions.sourceFormat = normalizedSourceFormat

      if (sourceEnabled && normalizedSourceFormat) {
        process.env.EXTENSION_SOURCE_FORMAT = normalizedSourceFormat
      }

      startOptions.sourceRedact = normalizeSourceRedactOption(
        startOptions.sourceRedact,
        normalizedSourceFormat
      )

      startOptions.sourceMeta = normalizeSourceMetaOption(
        startOptions.sourceMeta,
        sourceEnabled
      )

      startOptions.sourceProbe = normalizeSourceProbeOption(
        startOptions.sourceProbe
      )

      startOptions.sourceTree = normalizeSourceTreeOption(
        startOptions.sourceTree,
        sourceEnabled
      )

      startOptions.sourceConsole = normalizeSourceConsoleOption(
        startOptions.sourceConsole,
        sourceEnabled
      )

      startOptions.sourceDom = normalizeSourceDomOption(
        startOptions.sourceDom,
        startOptions.watchSource
      )

      startOptions.sourceMaxBytes = normalizeSourceMaxBytesOption(
        startOptions.sourceMaxBytes
      )

      startOptions.sourceIncludeShadow = normalizeSourceIncludeShadowOption(
        startOptions.sourceIncludeShadow,
        sourceEnabled
      )

      startOptions.sourceDiff = normalizeSourceDiffOption(
        startOptions.sourceDiff,
        startOptions.watchSource
      )

      // Load the matching develop runtime from the regular dependency graph.
      const {
        extensionStart
      }: {extensionStart: any} = require('extension-develop')

      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'start', vendor})

        const logsOption = (startOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          startOptions as unknown as {logContext?: string}
        ).logContext

        const logContexts = parseLogContexts(logContextOption)

        await extensionStart(pathOrRemoteUrl, {
          mode: 'production',
          profile: startOptions.profile,
          browser: vendor as StartOptions['browser'],
          chromiumBinary: startOptions.chromiumBinary,
          geckoBinary: startOptions.geckoBinary,
          startingUrl: startOptions.startingUrl,
          port: startOptions.port,
          install: startOptions.install,
          noRunner: startOptions.runner === false,
          extensions: parseExtensionsList(startOptions.extensions),
          source:
            typeof startOptions.source === 'string'
              ? startOptions.source
              : startOptions.source,
          watchSource: startOptions.watchSource,
          sourceFormat: startOptions.sourceFormat,
          sourceSummary: startOptions.sourceSummary,
          sourceMeta: startOptions.sourceMeta,
          sourceProbe: startOptions.sourceProbe,
          sourceTree: startOptions.sourceTree,
          sourceConsole: startOptions.sourceConsole,
          sourceDom: startOptions.sourceDom,
          sourceMaxBytes: startOptions.sourceMaxBytes,
          sourceRedact: startOptions.sourceRedact,
          sourceIncludeShadow: startOptions.sourceIncludeShadow,
          sourceDiff: startOptions.sourceDiff,
          logLevel: logsOption || startOptions.logLevel || 'off',
          logContexts,
          logFormat: startOptions.logFormat || 'pretty',
          logTimestamps: startOptions.logTimestamps !== false,
          logColor: startOptions.logColor !== false,
          logUrl: startOptions.logUrl,
          logTab: startOptions.logTab
        })

        telemetry.track('cli_vendor_finish', {
          command: 'start',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'start',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0
      })
    })
}
