//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type Command, Option} from 'commander'
import {normalizeProfileOption} from '../browsers/browsers-lib/resolve-profile'
import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {explicitCliValue} from '../helpers/cli-explicit'
import {
  cliGeckoBinary,
  firefoxBinaryAliasOption,
  geckoBinaryOption
} from '../helpers/cli-options'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {loadExtensionDevelopPreviewModule} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {resolveNoBrowser} from '../helpers/no-browser'
import {
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'
import {isJsonOutput} from '../helpers/output-flag'
import {
  type Browser,
  isSafariVendor,
  NO_SAFARI_BROWSER_TARGETS_HELP,
  validateVendors,
  vendors
} from '../helpers/vendors'

type PreviewOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  firefoxBinary?: string
  startingUrl?: string
  port?: string | number
  logLevel?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  extensions?: string
  outputPath?: string
  output?: 'pretty' | 'json'
  debug?: boolean
  author?: boolean
  authorMode?: boolean
}

// Copy the preview failure path is matched on, pinned by a spec against the
// real producers so a rewrite fails loudly instead of downgrading to E_INTERNAL.
export const PREVIEW_NOT_FOUND_NEEDLES = [
  'Preview is run-only',
  'Manifest file not found'
] as const

export function registerPreviewCommand(program: Command) {
  program
    .command('preview')
    .arguments('[project-name]')
    .usage('[path-to-remote-extension] [options]')
    .description(commandDescriptions.preview)
    .addHelpText(
      'after',
      '\nAdditional option:\n  --no-browser    do not launch the browser\n'
    )
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      `--browser <${NO_SAFARI_BROWSER_TARGETS_HELP}>`,
      'specify a browser/engine to run. Defaults to `chromium`'
    )
    .option(
      '--chromium-binary <path-to-binary>',
      'specify a path to the Chromium binary. This option overrides the --browser setting. Defaults to the system default'
    )
    .addOption(geckoBinaryOption())
    .addOption(firefoxBinaryAliasOption())
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
      '--extensions <list>',
      'comma-separated list of companion extensions or store URLs to load'
    )
    .option(
      '--output-path <dir>',
      'path to an existing unpacked extension directory. Defaults to dist/<browser> when available'
    )
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .addOption(
      new Option(
        '--debug',
        'print maintainer diagnostics alongside normal output'
      )
    )
    .addOption(
      new Option(
        '--author, --author-mode',
        'deprecated alias for --debug'
      ).hideHelp()
    )
    .action(
      async (
        pathOrRemoteUrl: string,
        options: PreviewOptions,
        command: Command
      ) => {
        const {browser = 'chromium', ...previewOptions} = options
        if (
          previewOptions.debug ||
          previewOptions.author ||
          previewOptions.authorMode
        ) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'
          if (!process.env.EXTENSION_VERBOSE)
            process.env.EXTENSION_VERBOSE = '1'
        }

        const asJson = isJsonOutput(previewOptions)
        // Tells develop to route human lines to stderr, so stdout carries
        // only the envelope and stays parseable as one JSON document.
        if (asJson) process.env.EXTENSION_OUTPUT = 'json'
        const emit = (frame: unknown) => {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(frame))
        }

        const list = vendors(browser)

        let unsupported = ''
        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            unsupported = invalid
            if (asJson) return
            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          }
        )

        if (!vendorsAreSupported) {
          if (asJson) {
            emit(
              ENVELOPE.fail('preview', 'usage', {
                code: CODES.E_UNSUPPORTED_BROWSER,
                message: `Unsupported browser: ${unsupported}.`
              })
            )
          }
          await exitAfterDrain(1)
          return
        }

        if (list.some(isSafariVendor)) {
          if (asJson) {
            // Not E_UNSUPPORTED_BROWSER: Safari is a supported browser, it is
            // this command that has no Safari path.
            emit(
              ENVELOPE.fail('preview', 'usage', {
                code: CODES.E_COMMAND_UNSUPPORTED_FOR_TARGET,
                message: 'Safari is not supported by preview.'
              })
            )
          } else {
            console.error(messages.safariCommandNotSupported('preview'))
          }
          await exitAfterDrain(1)
          return
        }

        if (!process.env.EXTJS_LIGHT) {
          const isRemote =
            typeof pathOrRemoteUrl === 'string' &&
            /^https?:/i.test(pathOrRemoteUrl)
          if (isRemote) process.env.EXTJS_LIGHT = '1'
        }

        const {extensionPreview} = await loadExtensionDevelopPreviewModule()
        const previewed: string[] = []

        for (const vendor of list) {
          const logsOption = (previewOptions as unknown as {logs?: string}).logs
          const logContextOption = (
            previewOptions as unknown as {logContext?: string}
          ).logContext

          const logContexts = parseLogContexts(logContextOption)

          try {
            await extensionPreview(
              pathOrRemoteUrl,
              {
                mode: 'production',
                profile: normalizeProfileOption(previewOptions.profile),
                browser: vendor as PreviewOptions['browser'],
                chromiumBinary: previewOptions.chromiumBinary,
                geckoBinary: cliGeckoBinary(previewOptions),
                startingUrl: previewOptions.startingUrl,
                port: previewOptions.port,
                noBrowser: await resolveNoBrowser(
                  pathOrRemoteUrl || process.cwd(),
                  'preview'
                ),
                extensions: parseExtensionsList(previewOptions.extensions),
                outputPath: previewOptions.outputPath,
                // Only pass logger values the user typed. Stock defaults and
                // commands.preview.* are applied inside extensionPreview.
                logLevel: logsOption || previewOptions.logLevel || undefined,
                logContexts,
                logFormat: previewOptions.logFormat,
                logTimestamps: explicitCliValue(
                  command,
                  'logTimestamps',
                  previewOptions.logTimestamps
                ),
                logColor: explicitCliValue(
                  command,
                  'logColor',
                  previewOptions.logColor
                ),
                logUrl: previewOptions.logUrl,
                logTab: previewOptions.logTab
              },
              // Browser launcher callback, runs browser code from extension/browser/
              // without pulling rspack into the preview path
              (opts: Parameters<typeof runOnlyPreviewBrowser>[0]) =>
                runOnlyPreviewBrowser(opts)
            )

            previewed.push(vendor)
          } catch (error) {
            if (!asJson) throw error

            const message =
              error instanceof Error ? error.message : String(error)
            // Preview never compiles: nothing to preview is the one failure the
            // caller can act on, so it gets its own status. Stopgap needles:
            // neither producer stamps a code on the error it throws.
            const nothingToPreview = PREVIEW_NOT_FOUND_NEEDLES.some((needle) =>
              message.includes(needle)
            )

            emit(
              ENVELOPE.fail(
                'preview',
                nothingToPreview ? 'not-found' : 'failed',
                {
                  code: nothingToPreview
                    ? CODES.E_PREVIEW_NO_DIST
                    : CODES.E_INTERNAL,
                  message
                },
                nothingToPreview
                  ? {hint: 'Run `extension build` before previewing.'}
                  : {}
              )
            )
            await exitAfterDrain(1)
            return
          }
        }

        if (asJson) {
          emit(
            ENVELOPE.ok('preview', 'ready', {
              projectPath: pathOrRemoteUrl,
              browsers: previewed
            })
          )
        }
      }
    )
}
