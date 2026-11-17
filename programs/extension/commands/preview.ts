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
import {refuseUnlistedChoices} from '../helpers/choice-flags'
import {explicitCliValue} from '../helpers/cli-explicit'
import {
  declaredErrorCode,
  failureHint,
  isLoadRefused,
  loadRefusedEnvelope
} from '../helpers/cli-failure'
import {
  cliGeckoBinary,
  firefoxBinaryAliasOption,
  geckoBinaryOption
} from '../helpers/cli-options'
import {resolveConfigBrowser} from '../helpers/config-browser'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {
  type AnyDevelopModule,
  loadExtensionDevelopModule,
  loadExtensionDevelopPreviewModule
} from '../helpers/extension-develop-runtime'
import {LOG_CONTEXTS} from '../helpers/log-contexts'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {
  CODES,
  ENVELOPE,
  type ErrorCode,
  stripChannelPrefix
} from '../helpers/messaging'
import {
  BROWSER_LAUNCH_HELP_FOOTER,
  NO_OPEN_FLAG_DESCRIPTION,
  resolveNoBrowser
} from '../helpers/no-browser'
import {
  firstInvalidWholeNumberFlag,
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {
  missingProjectFolder,
  missingProjectRefusal
} from '../helpers/project-folder'
import {markCommandSessionStart} from '../helpers/telemetry-cli'
import {
  type Browser,
  isSafariVendor,
  NO_SAFARI_BROWSER_TARGETS_HELP,
  unsupportedBrowserMessage,
  validateVendors,
  vendors
} from '../helpers/vendors'

export type PreviewOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  firefoxBinary?: string
  open?: boolean
  startingUrl?: string
  port?: string | number
  logs?: string
  logContext?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  extensions?: string
  allowControl?: boolean
  allowEval?: boolean
  outputPath?: string
  output?: 'pretty' | 'json'
  debug?: boolean
  authorMode?: boolean
}

// A run gone wrong, which dev and build report as failed too. Every other
// coded refusal is a value the caller has to change.
export const PREVIEW_FAILED_CODES: ReadonlySet<ErrorCode> = new Set([
  CODES.E_BROWSER_LAUNCH,
  CODES.E_BROWSER_NOT_FOUND,
  CODES.E_BROWSER_START_TIMEOUT,
  CODES.E_BROWSER_CONNECT,
  CODES.E_BROWSER_CONNECTION_CLOSED,
  CODES.E_RDP_PROTOCOL,
  CODES.E_ADDON_INSTALL,
  CODES.E_PROFILE_LOCKED,
  CODES.E_CONFIG_LOAD,
  CODES.E_RUNTIME_NOT_FOUND,
  CODES.E_REMOTE_DOWNLOAD,
  CODES.E_REMOTE_ACCESS_DENIED,
  CODES.E_REMOTE_ZIP_INVALID,
  CODES.E_REMOTE_FETCH_TIMEOUT
])

// Copy the preview failure path is matched on, pinned by a spec against the
// real producers so a rewrite fails loudly instead of downgrading to E_INTERNAL.
export const PREVIEW_NOT_FOUND_NEEDLES = [
  'Preview is run-only',
  'Manifest file not found'
] as const

// What the action reaches outside this file. Production takes every default.
interface PreviewCommandDeps {
  loadDevelop?: () => Promise<AnyDevelopModule>
  loadPreview?: () => Promise<AnyDevelopModule>
  runBrowser?: typeof runOnlyPreviewBrowser
}

export function registerPreviewCommand(
  program: Command,
  {
    loadDevelop = loadExtensionDevelopModule,
    loadPreview = loadExtensionDevelopPreviewModule,
    runBrowser = runOnlyPreviewBrowser
  }: PreviewCommandDeps = {}
) {
  program
    .command('preview')
    .arguments('[project-name]')
    .usage('[path-to-remote-extension] [options]')
    .description(commandDescriptions.preview)
    .addHelpText(
      'after',
      '\nAdditional options:\n' +
        '  --no-browser    stop the browser launch\n' +
        BROWSER_LAUNCH_HELP_FOOTER
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
      'specify a path to the Chromium binary. This option overrides the --browser setting and the binary variables. Without it the managed install runs, then the system install'
    )
    .addOption(geckoBinaryOption())
    .addOption(firefoxBinaryAliasOption())
    .option('--no-open', NO_OPEN_FLAG_DESCRIPTION)
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
      `[experimental] comma-separated contexts to include (${LOG_CONTEXTS.join(',')}). Use \`all\` to include all contexts (default)`
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
      '--allow-control',
      'open the agent-bridge control channel on the previewed build for bounded act (storage/reload/open). The browser loads a copy of the build with the control producer added; the build folder is unchanged'
    )
    .option(
      '--allow-eval',
      'additionally enable `extension eval` on the previewed build (implies --allow-control, runs arbitrary code in a context, writes a 0600 session token)'
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
    .hook('preAction', refuseUnreadableOutput())
    .hook('preAction', refuseUnlistedChoices())
    .action(
      async (
        pathOrRemoteUrl: string,
        options: PreviewOptions,
        command: Command
      ) => {
        const {browser: cliBrowser, ...previewOptions} = options
        // Only an untyped --browser falls through to extension.config.js
        // commands.preview.browser, then the stock chromium default.
        const browser =
          cliBrowser ??
          ((await resolveConfigBrowser(
            pathOrRemoteUrl || process.cwd(),
            'preview',
            loadDevelop
          )) as PreviewOptions['browser']) ??
          'chromium'

        if (previewOptions.debug || previewOptions.authorMode) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'

          if (!process.env.EXTENSION_VERBOSE) {
            process.env.EXTENSION_VERBOSE = '1'
          }
        }

        const asJson = isJsonOutput(previewOptions)
        // Tells develop to route human lines to stderr, so stdout carries
        // only the envelope and stays parseable as one JSON document.
        if (asJson) process.env.EXTENSION_OUTPUT = 'json'

        const emit = (frame: unknown) => {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(frame))
        }

        const invalidNumber = firstInvalidWholeNumberFlag([
          ['--port', previewOptions.port]
        ])

        if (invalidNumber) {
          const message = messages.invalidWholeNumberFlag(...invalidNumber)

          if (asJson) {
            emit(
              ENVELOPE.fail('preview', 'usage', {
                code: CODES.E_INVALID_OPTION,
                message
              })
            )
          } else {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          await exitAfterDrain(1)

          return
        }

        const list = vendors(browser)

        let unsupported = ''
        let supportedBrowsers: string[] = []
        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            unsupported = invalid
            supportedBrowsers = supported
            if (asJson) return

            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          },
          {allowEmulator: false, listSafari: false}
        )

        if (!vendorsAreSupported) {
          if (asJson) {
            emit(
              ENVELOPE.fail('preview', 'usage', {
                code: CODES.E_UNSUPPORTED_BROWSER,
                message: unsupportedBrowserMessage(
                  unsupported,
                  supportedBrowsers
                )
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

        const missingFolder = missingProjectFolder(pathOrRemoteUrl)

        if (missingFolder) {
          const refusal = missingProjectRefusal('preview', missingFolder)

          if (asJson) {
            emit(
              ENVELOPE.fail(
                'preview',
                'usage',
                {code: CODES.E_PROJECT_NOT_FOUND, message: refusal.message},
                {hint: refusal.hint}
              )
            )
          } else {
            // eslint-disable-next-line no-console
            console.error(refusal.stderr)
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

        // Counted at the handoff: preview holds the browser open and exits on
        // a signal, ten milliseconds after which its own handler kills it.
        markCommandSessionStart('preview')

        const {extensionPreview} = await loadPreview()
        const previewed: string[] = []
        const previewWarnings: string[] = []

        for (const vendor of list) {
          const logsOption = previewOptions.logs
          const logContextOption = previewOptions.logContext

          const logContexts = parseLogContexts(logContextOption)

          try {
            const previewResult = await extensionPreview(
              pathOrRemoteUrl,
              {
                mode: 'production',
                profile: normalizeProfileOption(previewOptions.profile),
                browser: vendor as PreviewOptions['browser'],
                chromiumBinary: previewOptions.chromiumBinary,
                geckoBinary: cliGeckoBinary(previewOptions),
                // Only forward a typed --no-open, so commands.preview.noOpen
                // and the stock default still decide when it is not typed.
                noOpen: explicitCliValue(
                  command,
                  'open',
                  previewOptions.open === false
                ),
                startingUrl: previewOptions.startingUrl,
                port: previewOptions.port,
                noBrowser: await resolveNoBrowser(
                  pathOrRemoteUrl || process.cwd(),
                  'preview',
                  loadDevelop
                ),
                extensions: parseExtensionsList(previewOptions.extensions),
                outputPath: previewOptions.outputPath,
                allowControl: Boolean(
                  previewOptions.allowControl || previewOptions.allowEval
                ),
                allowEval: Boolean(previewOptions.allowEval),
                // Only pass logger values the user typed. Stock defaults and
                // commands.preview.* are applied inside extensionPreview.
                logLevel: logsOption || undefined,
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
                runBrowser(opts)
            )

            previewed.push(vendor)

            for (const warning of previewResult?.warnings ?? []) {
              if (!previewWarnings.includes(warning)) {
                previewWarnings.push(warning)
              }
            }
          } catch (error) {
            if (!asJson) throw error

            const rendered =
              error instanceof Error ? error.message : String(error)
            const message = stripChannelPrefix(rendered)
            // A producer that tagged its own failure is believed over any
            // text match, which is a guess by construction.
            const declared = declaredErrorCode(error)

            // The browser came up and turned the extension away, which is a
            // different failure from having nothing built.
            if (isLoadRefused(error)) {
              emit(loadRefusedEnvelope(error, 'preview'))

              await exitAfterDrain(1)

              return
            }

            if (declared) {
              // A browser, config or remote archive that failed is a failed
              // run and not a mistyped command.
              const status = PREVIEW_FAILED_CODES.has(declared)
                ? 'failed'
                : 'usage'
              const hint = failureHint(declared)

              emit(
                ENVELOPE.fail(
                  'preview',
                  status,
                  {code: declared, message},
                  hint ? {hint} : {}
                )
              )

              await exitAfterDrain(1)

              return
            }

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
            ENVELOPE.ok(
              'preview',
              'ready',
              {
                projectPath: pathOrRemoteUrl,
                browsers: previewed
              },
              {warnings: previewWarnings}
            )
          )
        }
      }
    )
}
