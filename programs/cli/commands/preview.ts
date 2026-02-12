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

type PreviewOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
  runner?: boolean
  // Source inspection (parity with dev)
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
  // Unified logger options (parity with dev)
  logLevel?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  extensions?: string
  author?: boolean
  authorMode?: boolean
}

const require = createRequire(import.meta.url)

export function registerPreviewCommand(program: Command, telemetry: any) {
  program
    .command('preview')
    .arguments('[project-name]')
    .usage('preview [path-to-remote-extension] [options]')
    .description(commandDescriptions.preview)
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
      '--starting-url <url>',
      'specify the starting URL for the browser. Defaults to `undefined`'
    )
    .option('--no-runner', 'do not launch the browser runner')
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
      '--author, --author-mode',
      '[internal] enable maintainer diagnostics (does not affect user runtime logs)'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...previewOptions}: PreviewOptions
    ) {
      if (previewOptions.author || previewOptions['authorMode']) {
        process.env.EXTENSION_AUTHOR_MODE = 'true'
        if (!process.env.EXTENSION_VERBOSE) process.env.EXTENSION_VERBOSE = '1'
      }

      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'preview',
        vendors: vendors(browser)
      })

      const list = vendors(browser)
      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      if (!process.env.EXTJS_LIGHT) {
        const isRemote =
          typeof pathOrRemoteUrl === 'string' &&
          /^https?:/i.test(pathOrRemoteUrl)
        if (isRemote) process.env.EXTJS_LIGHT = '1'
      }

      const normalizedSource = normalizeSourceOption(
        previewOptions.source,
        previewOptions.startingUrl
      )

      if (normalizedSource) {
        previewOptions.source = normalizedSource
      }

      const sourceEnabled = Boolean(
        previewOptions.source || previewOptions.watchSource
      )

      const normalizedSourceFormat = normalizeSourceFormatOption({
        sourceFormat: previewOptions.sourceFormat,
        logFormat: previewOptions.logFormat,
        sourceEnabled
      })

      previewOptions.sourceFormat = normalizedSourceFormat

      if (sourceEnabled && normalizedSourceFormat) {
        process.env.EXTENSION_SOURCE_FORMAT = normalizedSourceFormat
      }

      previewOptions.sourceRedact = normalizeSourceRedactOption(
        previewOptions.sourceRedact,
        normalizedSourceFormat
      )

      previewOptions.sourceMeta = normalizeSourceMetaOption(
        previewOptions.sourceMeta,
        sourceEnabled
      )

      previewOptions.sourceProbe = normalizeSourceProbeOption(
        previewOptions.sourceProbe
      )

      previewOptions.sourceTree = normalizeSourceTreeOption(
        previewOptions.sourceTree,
        sourceEnabled
      )

      previewOptions.sourceConsole = normalizeSourceConsoleOption(
        previewOptions.sourceConsole,
        sourceEnabled
      )

      previewOptions.sourceDom = normalizeSourceDomOption(
        previewOptions.sourceDom,
        previewOptions.watchSource
      )

      previewOptions.sourceMaxBytes = normalizeSourceMaxBytesOption(
        previewOptions.sourceMaxBytes
      )

      previewOptions.sourceIncludeShadow = normalizeSourceIncludeShadowOption(
        previewOptions.sourceIncludeShadow,
        sourceEnabled
      )

      previewOptions.sourceDiff = normalizeSourceDiffOption(
        previewOptions.sourceDiff,
        previewOptions.watchSource
      )

      // Load the matching develop runtime from the regular dependency graph.
      const {
        extensionPreview
      }: {extensionPreview: any} = require('extension-develop')

      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'preview', vendor})

        const logsOption = (previewOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          previewOptions as unknown as {logContext?: string}
        ).logContext

        const logContexts = parseLogContexts(logContextOption)

        await extensionPreview(pathOrRemoteUrl, {
          mode: 'production',
          profile: previewOptions.profile,
          browser: vendor as PreviewOptions['browser'],
          chromiumBinary: previewOptions.chromiumBinary,
          geckoBinary: previewOptions.geckoBinary,
          startingUrl: previewOptions.startingUrl,
          port: previewOptions.port,
          noRunner: previewOptions.runner === false,
          extensions: parseExtensionsList(previewOptions.extensions),
          source:
            typeof previewOptions.source === 'string'
              ? previewOptions.source
              : previewOptions.source,
          watchSource: previewOptions.watchSource,
          sourceFormat: previewOptions.sourceFormat,
          sourceSummary: previewOptions.sourceSummary,
          sourceMeta: previewOptions.sourceMeta,
          sourceProbe: previewOptions.sourceProbe,
          sourceTree: previewOptions.sourceTree,
          sourceConsole: previewOptions.sourceConsole,
          sourceDom: previewOptions.sourceDom,
          sourceMaxBytes: previewOptions.sourceMaxBytes,
          sourceRedact: previewOptions.sourceRedact,
          sourceIncludeShadow: previewOptions.sourceIncludeShadow,
          sourceDiff: previewOptions.sourceDiff,
          logLevel: logsOption || previewOptions.logLevel || 'off',
          logContexts,
          logFormat: previewOptions.logFormat || 'pretty',
          logTimestamps: previewOptions.logTimestamps !== false,
          logColor: previewOptions.logColor !== false,
          logUrl: previewOptions.logUrl,
          logTab: previewOptions.logTab
        })
        telemetry.track('cli_vendor_finish', {
          command: 'preview',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'preview',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0
      })
    })
}
