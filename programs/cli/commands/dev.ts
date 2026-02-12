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
  normalizeSourceOption,
  normalizeSourceFormatOption,
  normalizeSourceIncludeShadowOption,
  normalizeSourceMaxBytesOption,
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

type DevOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  persistProfile?: boolean
  chromiumBinary?: string
  geckoBinary?: string
  polyfill?: boolean | string
  open?: boolean
  startingUrl?: string
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
  logLevel?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  install?: boolean
  runner?: boolean
  extensions?: string
}

const require = createRequire(import.meta.url)

export function registerDevCommand(program: Command, telemetry: any) {
  program
    .command('dev')
    .arguments('[project-path|remote-url]')
    .usage('dev [project-path|remote-url] [options]')
    .description(commandDescriptions.dev)
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      '--browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based>',
      'specify a browser/engine to run. Defaults to `chromium`'
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
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `false`'
    )
    .option(
      '--no-open',
      'do not open the browser automatically (default: open)'
    )
    .option(
      '--no-runner',
      'do not launch the browser runner (dev server still starts)'
    )
    .option(
      '--starting-url <url>',
      'specify the starting URL for the browser. Defaults to `undefined`'
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
      '[experimental] re-print HTML on rebuilds or file changes (defaults to true when --source is present)',
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
      '[internal] install project dependencies when missing',
      parseOptionalBoolean
    )
    .option(
      '--author, --author-mode',
      '[internal] enable maintainer diagnostics (does not affect user runtime logs)'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...devOptions}: DevOptions
    ) {
      if ((devOptions as any).author || (devOptions as any)['authorMode']) {
        process.env.EXTENSION_AUTHOR_MODE = 'true'
        if (!process.env.EXTENSION_VERBOSE) process.env.EXTENSION_VERBOSE = '1'
      }

      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'dev',
        vendors: vendors(browser),
        polyfill_used:
          devOptions.polyfill?.toString() === 'false' ? false : true,
        log_level: devOptions.logLevel || 'off',
        log_format: devOptions.logFormat || 'pretty',
        custom_binary_used: Boolean(
          devOptions.chromiumBinary || devOptions.geckoBinary
        )
      })

      const list = vendors(browser)
      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      // Normalize source/watch behavior:
      // - If --source present without URL, fall back to startingUrl or https://example.com
      // - When --source is provided, enable watch mode by default
      const normalizedSource = normalizeSourceOption(
        devOptions.source,
        devOptions.startingUrl
      )
      if (normalizedSource) {
        devOptions.source = normalizedSource
        if (typeof devOptions.watchSource === 'undefined') {
          devOptions.watchSource = true
        }
      }

      const sourceEnabled = Boolean(devOptions.source || devOptions.watchSource)
      const normalizedSourceFormat = normalizeSourceFormatOption({
        sourceFormat: (devOptions as any).sourceFormat,
        logFormat: devOptions.logFormat,
        sourceEnabled
      })

      devOptions.sourceFormat = normalizedSourceFormat
      if (sourceEnabled && normalizedSourceFormat) {
        process.env.EXTENSION_SOURCE_FORMAT = normalizedSourceFormat
      }

      devOptions.sourceRedact = normalizeSourceRedactOption(
        devOptions.sourceRedact,
        normalizedSourceFormat
      )

      devOptions.sourceMeta = normalizeSourceMetaOption(
        devOptions.sourceMeta,
        sourceEnabled
      )

      devOptions.sourceProbe = normalizeSourceProbeOption(
        devOptions.sourceProbe
      )

      devOptions.sourceTree = normalizeSourceTreeOption(
        devOptions.sourceTree,
        sourceEnabled
      )

      devOptions.sourceConsole = normalizeSourceConsoleOption(
        devOptions.sourceConsole,
        sourceEnabled
      )

      devOptions.sourceDom = normalizeSourceDomOption(
        devOptions.sourceDom,
        devOptions.watchSource
      )

      devOptions.sourceMaxBytes = normalizeSourceMaxBytesOption(
        devOptions.sourceMaxBytes
      )

      devOptions.sourceIncludeShadow = normalizeSourceIncludeShadowOption(
        devOptions.sourceIncludeShadow,
        sourceEnabled
      )

      devOptions.sourceDiff = normalizeSourceDiffOption(
        devOptions.sourceDiff,
        devOptions.watchSource
      )

      // Load the matching develop runtime from the regular dependency graph.
      const {extensionDev}: {extensionDev: any} = require('extension-develop')

      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'dev', vendor})

        const logsOption = (devOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          devOptions as unknown as {logContext?: string}
        ).logContext

        const devArgs: any = {
          ...devOptions,
          profile: devOptions.profile,
          browser: vendor as DevOptions['browser'],
          chromiumBinary: devOptions.chromiumBinary,
          geckoBinary: devOptions.geckoBinary,
          polyfill: devOptions.polyfill?.toString() === 'false' ? false : true,
          open: devOptions.open,
          startingUrl: devOptions.startingUrl,
          source: devOptions.source,
          watchSource: devOptions.watchSource,
          sourceFormat: devOptions.sourceFormat,
          sourceSummary: devOptions.sourceSummary,
          sourceMeta: devOptions.sourceMeta,
          sourceProbe: devOptions.sourceProbe,
          sourceTree: devOptions.sourceTree,
          sourceConsole: devOptions.sourceConsole,
          sourceDom: devOptions.sourceDom,
          sourceMaxBytes: devOptions.sourceMaxBytes,
          sourceRedact: devOptions.sourceRedact,
          sourceIncludeShadow: devOptions.sourceIncludeShadow,
          sourceDiff: devOptions.sourceDiff,
          install: devOptions.install,
          noRunner: devOptions.runner === false,
          extensions: parseExtensionsList(devOptions.extensions),
          logLevel: (logsOption || devOptions.logLevel || 'off') as any,
          logContexts: parseLogContexts(logContextOption),
          logFormat: devOptions.logFormat || 'pretty',
          logTimestamps: devOptions.logTimestamps !== false,
          logColor: devOptions.logColor !== false,
          logUrl: devOptions.logUrl,
          logTab: devOptions.logTab
        }

        await extensionDev(pathOrRemoteUrl, devArgs)

        telemetry.track('cli_vendor_finish', {
          command: 'dev',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'dev',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0
      })
    })
}
