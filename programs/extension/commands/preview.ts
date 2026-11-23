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
import {browserForBinaryFlags} from '../helpers/binary-flag-browser'
import {
  refuseUnknownListItems,
  refuseUnlistedChoices
} from '../helpers/choice-flags'
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
import {exitAfterDrain, exitFailedAfterDrain} from '../helpers/exit-after-drain'
import {
  type DevelopBrowser,
  type DevelopModule,
  type DevelopPreviewLauncher,
  type DevelopPreviewModule,
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
  parseLogContexts,
  parseLogFormat,
  parseLogLevel
} from '../helpers/normalize-options'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {
  missingProjectFolder,
  missingProjectRefusal
} from '../helpers/project-folder'
import {writeFrameWhenInterrupted} from '../helpers/session-interrupt-frame'
import {
  markCommandSessionStart,
  noteRunBrowsers
} from '../helpers/telemetry-cli'
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
  host?: string
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
  CODES.E_PORT_UNAVAILABLE,
  CODES.E_CONFIG_LOAD,
  CODES.E_PACKAGE_JSON_INVALID,
  CODES.E_RUNTIME_NOT_FOUND,
  CODES.E_REMOTE_DOWNLOAD,
  CODES.E_REMOTE_ACCESS_DENIED,
  CODES.E_REMOTE_ZIP_INVALID,
  CODES.E_REMOTE_FETCH_TIMEOUT
])

const PREVIEW_NO_DIST_HINT = 'Run `extension build` before previewing.'

// Copy matched only when the engine throws uncoded, pinned against the real
// producers so a rewrite fails loudly instead of downgrading to E_INTERNAL.
export const PREVIEW_NOT_FOUND_NEEDLES = [
  'Preview is run-only',
  'Manifest file not found'
] as const

// What the action reaches outside this file. Production takes every default.
interface PreviewCommandDeps {
  loadDevelop?: () => Promise<DevelopModule>
  loadPreview?: () => Promise<DevelopPreviewModule>
  runBrowser?: typeof runOnlyPreviewBrowser
  noteBrowsers?: typeof noteRunBrowsers
}

export function registerPreviewCommand(
  program: Command,
  {
    loadDevelop = loadExtensionDevelopModule,
    loadPreview = loadExtensionDevelopPreviewModule,
    runBrowser = runOnlyPreviewBrowser,
    noteBrowsers = noteRunBrowsers
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
      'specify a path to the Chromium binary. It overrides the binary variables, and a --browser beside it must be a Chromium one. Without it the managed install runs, then the system install'
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
      "seed the browser's debugging port, which listens on this value plus 100. Without it the browser listens on 9222"
    )
    .option(
      '--host <host>',
      'host the control channel binds to under --allow-control or --allow-eval. Nothing else listens. Defaults to `127.0.0.1`'
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
    .hook(
      'preAction',
      refuseUnknownListItems('--log-context', [...LOG_CONTEXTS, 'all'])
    )
    .action(
      async (
        pathOrRemoteUrl: string,
        options: PreviewOptions,
        command: Command
      ) => {
        const {browser: cliBrowser, ...previewOptions} = options
        // Only an untyped --browser falls through to extension.config.js
        // commands.preview.browser, then the stock chromium default.
        const binaryPick = browserForBinaryFlags({
          typedBrowser: cliBrowser,
          configBrowser:
            cliBrowser !== undefined
              ? undefined
              : await resolveConfigBrowser(
                  pathOrRemoteUrl || process.cwd(),
                  'preview',
                  loadDevelop
                ),
          chromiumBinary: previewOptions.chromiumBinary,
          geckoBinary: cliGeckoBinary(previewOptions)
        })
        const browser = (binaryPick.browser ?? 'chromium') as NonNullable<
          PreviewOptions['browser']
        >

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
        noteBrowsers(list)

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

        if (binaryPick.refusal) {
          if (asJson) {
            emit(
              ENVELOPE.fail('preview', 'usage', {
                code: CODES.E_INVALID_OPTION,
                message: binaryPick.refusal
              })
            )
          } else {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(binaryPick.refusal))
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

        const {extensionPreview}: DevelopPreviewModule = await loadPreview()
        const previewed: string[] = []
        const previewWarnings: string[] = []
        const noBrowser = await resolveNoBrowser(
          pathOrRemoteUrl || process.cwd(),
          'preview',
          loadDevelop,
          list[0]
        )

        // Armed before the first launch: a signal can arrive while the
        // browser is still coming up, before any frame was written.
        if (asJson) {
          writeFrameWhenInterrupted(
            'preview',
            () => ({projectPath: pathOrRemoteUrl, browsers: list, noBrowser}),
            emit
          )
        }

        for (const vendor of list) {
          const logsOption = previewOptions.logs
          const logContextOption = previewOptions.logContext

          const logContexts = parseLogContexts(logContextOption)

          try {
            const previewResult = await extensionPreview(
              pathOrRemoteUrl,
              {
                profile: normalizeProfileOption(previewOptions.profile),
                browser: vendor as DevelopBrowser,
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
                host: previewOptions.host,
                noBrowser,
                extensions: parseExtensionsList(previewOptions.extensions),
                outputPath: previewOptions.outputPath,
                allowControl: Boolean(
                  previewOptions.allowControl || previewOptions.allowEval
                ),
                allowEval: Boolean(previewOptions.allowEval),
                // Only pass logger values the user typed. Stock defaults and
                // commands.preview.* are applied inside extensionPreview.
                logLevel: parseLogLevel(logsOption),
                logContexts,
                logFormat: parseLogFormat(previewOptions.logFormat),
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
              (opts) =>
                runBrowser(
                  opts as Parameters<typeof runOnlyPreviewBrowser>[0]
                ) as ReturnType<DevelopPreviewLauncher>
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
              // run and not a mistyped command. Nothing built yet is its own.
              const nothingBuilt = declared === CODES.E_PREVIEW_NO_DIST
              const status = nothingBuilt
                ? 'not-found'
                : PREVIEW_FAILED_CODES.has(declared)
                  ? 'failed'
                  : 'usage'
              // A file of the project could not be read. build, start and dev
              // frame that from their build step, and this reads the same.
              const configFailed =
                declared === CODES.E_CONFIG_LOAD ||
                declared === CODES.E_PACKAGE_JSON_INVALID
              const hint = nothingBuilt
                ? PREVIEW_NO_DIST_HINT
                : configFailed
                  ? 'Fix the error above and run preview again.'
                  : failureHint(declared)

              emit(
                ENVELOPE.fail(
                  'preview',
                  status,
                  {
                    code: declared,
                    message,
                    // A failed run names the thrown error as the top-level
                    // sink does, so start and preview read the same.
                    ...(status === 'failed' && !configFailed
                      ? {name: error instanceof Error ? error.name : 'Error'}
                      : {})
                  },
                  hint ? {hint} : {}
                )
              )

              await exitFailedAfterDrain({code: declared, exitCode: 1})

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
                nothingToPreview ? {hint: PREVIEW_NO_DIST_HINT} : {}
              )
            )

            await exitFailedAfterDrain({
              code: nothingToPreview
                ? CODES.E_PREVIEW_NO_DIST
                : CODES.E_INTERNAL,
              exitCode: 1,
              error,
              step: 'engine'
            })

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
                // The targets the run was for. noBrowser says whether any of
                // them was launched, as the dev and start frames do.
                browsers: previewed,
                noBrowser
              },
              {warnings: previewWarnings}
            )
          )
        }
      }
    )
}
