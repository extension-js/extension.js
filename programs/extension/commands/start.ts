//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {type Command, Option} from 'commander'
import {normalizeProfileOption} from '../browsers/browsers-lib/resolve-profile'
import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {refuseUnlistedChoices} from '../helpers/choice-flags'
import {
  explicitCliValue,
  explicitOptionalBoolean
} from '../helpers/cli-explicit'
import {declaredErrorCode} from '../helpers/cli-failure'
import {
  cliGeckoBinary,
  firefoxBinaryAliasOption,
  geckoBinaryOption
} from '../helpers/cli-options'
import {getCliPackageJson} from '../helpers/cli-package-json'
import {resolveConfigBrowser} from '../helpers/config-browser'
import {exitWithFailure} from '../helpers/exit-after-drain'
import {
  type DevelopBrowser,
  type DevelopPreviewLauncher,
  type AnyDevelopModule,
  type DevelopFor,
  type DevelopPreviewModule,
  loadExtensionDevelopModule,
  loadExtensionDevelopPreviewModule
} from '../helpers/extension-develop-runtime'
import {LOG_CONTEXTS} from '../helpers/log-contexts'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
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
import {
  refuseUnreadableOutput,
  resolveOutputFormat
} from '../helpers/output-flag'
import {checkProjectCliVersion} from '../helpers/project-cli-version'
import {
  missingProjectFolder,
  missingProjectRefusal
} from '../helpers/project-folder'
import {
  markCommandSessionStart,
  noteRunBrowsers
} from '../helpers/telemetry-cli'
import {
  type Browser,
  isSafariVendor,
  NO_SAFARI_BROWSER_TARGETS_HELP,
  parseOptionalBoolean,
  unsupportedBrowserMessage,
  validateVendors,
  vendors
} from '../helpers/vendors'
import {describeWaitError, framedWaitFailure, runWaitMode} from './dev-wait'

export type StartOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  firefoxBinary?: string
  startingUrl?: string
  port?: string | number
  host?: string
  publicHost?: string
  polyfill?: boolean | string
  open?: boolean
  install?: boolean
  debug?: boolean
  authorMode?: boolean
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
  wait?: boolean
  waitTimeout?: string | number
  waitFormat?: 'pretty' | 'json'
  output?: 'pretty' | 'json'
}

function printFrame(frame: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(frame))
}

// Under --output json a bare exit leaves stdout empty, so a machine consumer
// reads exit 1 and has nothing to explain it. Print the frame before exiting.
function failAndExit(
  asJson: boolean,
  status: string,
  error: {code: ErrorCode; message: string},
  hint?: string
): never {
  if (asJson) {
    printFrame(ENVELOPE.fail('start', status, error, hint ? {hint} : {}))
  }

  exitWithFailure(error.code)
}

// What the action reaches outside this file. Production takes every default.
interface StartCommandDeps {
  loadDevelop?: () => Promise<AnyDevelopModule>
  loadPreview?: () => Promise<AnyDevelopModule>
  runBrowser?: typeof runOnlyPreviewBrowser
  waitForReady?: typeof runWaitMode
  noteBrowsers?: typeof noteRunBrowsers
}

export function registerStartCommand(
  program: Command,
  {
    loadDevelop = loadExtensionDevelopModule,
    loadPreview = loadExtensionDevelopPreviewModule,
    runBrowser = runOnlyPreviewBrowser,
    waitForReady = runWaitMode,
    noteBrowsers = noteRunBrowsers
  }: StartCommandDeps = {}
) {
  program
    .command('start')
    .arguments('[project-path|remote-url]')
    .usage('[project-path|remote-url] [options]')
    .description(commandDescriptions.start)
    .addHelpText(
      'after',
      '\nAdditional options:\n' +
        '  --no-browser    stop the browser launch, the build still runs\n' +
        '  --wait          wait for ready contract and exit, pair with --output json for machine output\n' +
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
      '--polyfill [boolean]',
      'bundle the cross-browser polyfill, for a Chromium older than 148 (152 with a devtools_page). Defaults to `false`',
      parseOptionalBoolean
    )
    .option('--no-polyfill', 'disable the cross-browser polyfill')
    .option('--no-open', NO_OPEN_FLAG_DESCRIPTION)
    .option(
      '--chromium-binary <path-to-binary>',
      'specify a path to the Chromium binary. This option overrides the --browser setting and the binary variables. Without it the managed install runs, then the system install'
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
      '--host <host>',
      'specify the host to bind the dev server to. Use 0.0.0.0 for Docker/devcontainers. Defaults to `127.0.0.1`'
    )
    // Accepted and ignored: start serves nothing a browser dials, and a
    // caller that shares its flags with dev must not be refused for it.
    .option(
      '--public-host <host>',
      'accepted for parity with `dev`. `start` serves nothing, so this has no effect'
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
      'open the agent-bridge control channel on the production run for bounded act (storage/reload/open). The browser loads a copy of the build with the control producer added; dist/ is unchanged'
    )
    .option(
      '--allow-eval',
      'additionally enable `extension eval` on the production run (implies --allow-control, runs arbitrary code in a context, writes a 0600 session token)'
    )
    .option(
      '--install [boolean]',
      '[internal] install project dependencies when missing',
      parseOptionalBoolean
    )
    .option(
      '--wait [boolean]',
      'wait for dist/extension-js/<browser>/ready.json and exit',
      parseOptionalBoolean
    )
    .option(
      '--wait-timeout <ms>',
      'timeout in milliseconds when using --wait (default: 60000)'
    )
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .addOption(
      // Deprecated alias of --output. Hidden so --help advertises one name;
      // resolveOutputFormat still honors it and warns once on stderr.
      new Option('--wait-format <pretty|json>').hideHelp()
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
        options: StartOptions,
        command: Command
      ) => {
        const {browser: cliBrowser, ...startOptions} = options
        // Only an untyped --browser falls through to extension.config.js
        // commands.start.browser, then the stock chromium default.
        const browser =
          cliBrowser ??
          ((await resolveConfigBrowser(
            pathOrRemoteUrl || process.cwd(),
            'start',
            loadDevelop
          )) as StartOptions['browser']) ??
          'chromium'

        if (startOptions.debug || startOptions.authorMode) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'

          if (!process.env.EXTENSION_VERBOSE) {
            process.env.EXTENSION_VERBOSE = '1'
          }
        }

        const asJson = resolveOutputFormat(startOptions) === 'json'

        const cliVersion = checkProjectCliVersion(
          path.resolve(pathOrRemoteUrl || process.cwd()),
          getCliPackageJson().version as string
        )

        if (cliVersion) {
          // eslint-disable-next-line no-console
          console.warn(
            messages.projectCliVersionMismatch(
              cliVersion.running,
              cliVersion.declared,
              cliVersion.range,
              cliVersion.command
            )
          )
        }

        const invalidNumber = firstInvalidWholeNumberFlag([
          ['--port', startOptions.port],
          ['--wait-timeout', startOptions.waitTimeout]
        ])

        if (invalidNumber) {
          const message = messages.invalidWholeNumberFlag(...invalidNumber)

          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          failAndExit(asJson, 'usage', {code: CODES.E_INVALID_OPTION, message})
        }

        if (startOptions.waitTimeout !== undefined && !startOptions.wait) {
          const message = messages.waitTimeoutWithoutWait()

          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          failAndExit(asJson, 'usage', {code: CODES.E_INVALID_OPTION, message})
        }

        // Tells develop to route human lines to stderr, so stdout carries
        // only the envelope and stays parseable as one JSON document.
        if (asJson) process.env.EXTENSION_OUTPUT = 'json'

        const list = vendors(browser)
        noteBrowsers(list)
        let unsupportedBrowser = ''
        let supportedBrowsers: string[] = []

        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            unsupportedBrowser = invalid
            supportedBrowsers = supported
            if (asJson) return

            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          },
          {allowEmulator: false, listSafari: false}
        )

        if (!vendorsAreSupported) {
          failAndExit(asJson, 'usage', {
            code: CODES.E_UNSUPPORTED_BROWSER,
            message: unsupportedBrowserMessage(
              unsupportedBrowser,
              supportedBrowsers
            )
          })
        }

        if (list.some(isSafariVendor)) {
          if (!asJson) {
            console.error(messages.safariCommandNotSupported('start'))
          }

          // Not E_UNSUPPORTED_BROWSER: Safari is a supported browser, it is
          // this command that has no Safari path.
          failAndExit(asJson, 'usage', {
            code: CODES.E_COMMAND_UNSUPPORTED_FOR_TARGET,
            message: 'Safari is not supported by start.'
          })
        }

        const missingFolder = missingProjectFolder(pathOrRemoteUrl)

        if (missingFolder) {
          const refusal = missingProjectRefusal('start', missingFolder)

          // eslint-disable-next-line no-console
          if (!asJson) console.error(refusal.stderr)

          failAndExit(
            asJson,
            'usage',
            {code: CODES.E_PROJECT_NOT_FOUND, message: refusal.message},
            refusal.hint
          )
        }

        if (startOptions.wait) {
          // --wait polls the ready contract and never starts a server, so with
          // --no-browser this run would poll for a file it never writes. Refuse
          // instead of burning the whole --wait-timeout on a certain failure.
          // Only the typed flag counts: commands.start.noBrowser in
          // extension.config.js belongs to the producer process, and refusing
          // there would break the documented two-process pattern.
          if (process.env.EXTENSION_CLI_NO_BROWSER === '1') {
            if (!asJson) {
              // eslint-disable-next-line no-console
              console.error(messages.noBrowserWithWait('start'))
            }

            failAndExit(asJson, 'usage', {
              code: CODES.E_INVALID_OPTION,
              message:
                '--no-browser and --wait cannot run in the same process. Run `extension start --no-browser` in one process and `extension start --wait` in another.'
            })
          }

          // The deprecated --wait-format alias already mapped onto --output in
          // resolveOutputFormat, so one flag decides the whole stdout dialect.
          const waitAsJson = asJson
          let waitResult: Awaited<ReturnType<typeof runWaitMode>>

          try {
            waitResult = await waitForReady({
              command: 'start',
              pathOrRemoteUrl,
              browsers: list,
              waitTimeout: startOptions.waitTimeout,
              waitFormat: waitAsJson ? 'json' : 'pretty'
            })
          } catch (error) {
            // A throw here used to leave stdout empty, so a machine consumer
            // saw exit 1 and no frame explaining it.
            const failure = describeWaitError(error)

            if (waitAsJson) {
              printFrame(
                ENVELOPE.fail(
                  'start',
                  failure.status,
                  {code: failure.code, message: failure.message},
                  {hint: failure.hint}
                )
              )
            }

            throw framedWaitFailure(error, failure, waitAsJson)
          }

          if (waitAsJson) {
            // mode/command/browsers/results are the pre-envelope wait frame,
            // kept whole inside value so no consumer loses a field.
            printFrame(
              ENVELOPE.ok('start', 'ready', {
                mode: 'wait',
                command: 'start',
                browsers: waitResult.browsers,
                results: waitResult.results
              })
            )
          }

          return
        }

        // Counted here rather than at an exit `start` does not reach: it keeps
        // running behind the launched browser until a signal ends it.
        markCommandSessionStart('start')

        const {extensionBuild}: DevelopFor<'extensionBuild'> =
          await loadDevelop()
        const noBrowser = await resolveNoBrowser(
          pathOrRemoteUrl || process.cwd(),
          'start',
          loadDevelop
        )

        for (const vendor of list) {
          const logsOption = startOptions.logs
          const logContextOption = startOptions.logContext

          const logContexts = parseLogContexts(logContextOption)
          // Unset stays undefined so commands.start.* and stock defaults
          // apply inside develop instead of a forced value here.
          const logLevel = parseLogLevel(logsOption)

          try {
            await extensionBuild(pathOrRemoteUrl, {
              browser: vendor as DevelopBrowser,
              // CLI surface: a failed build ends this process with the clean
              // error line. Library imports of extensionBuild reject instead.
              // Under --output json we catch instead, so the failure can be
              // reported as one envelope rather than a bare exit code.
              exitOnError: !asJson,
              // The build-phase receipt should name the command the user ran.
              metadataCommand: 'start',
              // With a launch ahead the receipt is not the session being
              // ready, so the build leaves that stamp to the launch phase.
              launchFollows: !noBrowser,
              // Pass polyfill only when typed so commands.start.polyfill can
              // apply. The start build phase defaults it off downstream.
              polyfill: explicitCliValue(
                command,
                'polyfill',
                explicitOptionalBoolean(startOptions.polyfill)
              ),
              install: startOptions.install,
              extensions: parseExtensionsList(startOptions.extensions),
              silent: true
            })
          } catch (error) {
            if (!asJson) throw error

            printFrame(
              ENVELOPE.fail(
                'start',
                'build-failed',
                {
                  code: declaredErrorCode(error) ?? CODES.E_COMPILE,
                  message:
                    error instanceof Error ? error.message : String(error)
                },
                {hint: 'Fix the error above and run start again.'}
              )
            )

            exitWithFailure(declaredErrorCode(error) ?? CODES.E_COMPILE)
          }

          if (noBrowser) {
            continue
          }

          // Launch the browser through the preview module, which resolves the
          // project structure and extensions-to-load.
          const {extensionPreview}: DevelopPreviewModule = await loadPreview()

          await extensionPreview(
            pathOrRemoteUrl,
            {
              mode: 'production',
              profile: normalizeProfileOption(startOptions.profile),
              browser: vendor as DevelopBrowser,
              chromiumBinary: startOptions.chromiumBinary,
              geckoBinary: cliGeckoBinary(startOptions),
              startingUrl: startOptions.startingUrl,
              port: startOptions.port,
              host: startOptions.host,
              noBrowser: false,
              // Only forward a typed --no-open, so commands.start.noOpen and
              // the stock default still decide when the user left it alone.
              noOpen: explicitCliValue(
                command,
                'open',
                startOptions.open === false
              ),
              extensions: parseExtensionsList(startOptions.extensions),
              metadataCommand: 'start',
              allowControl: Boolean(
                startOptions.allowControl || startOptions.allowEval
              ),
              allowEval: Boolean(startOptions.allowEval),
              logLevel,
              logContexts,
              // Only pass logger values the user typed. Stock defaults and
              // commands.start.* are applied inside extensionPreview.
              logFormat: parseLogFormat(startOptions.logFormat),
              logTimestamps: explicitCliValue(
                command,
                'logTimestamps',
                startOptions.logTimestamps
              ),
              logColor: explicitCliValue(
                command,
                'logColor',
                startOptions.logColor
              ),
              logUrl: startOptions.logUrl,
              logTab: startOptions.logTab
            },
            (opts) =>
              runBrowser({
                ...opts,
                browser: opts.browser as DevelopBrowser,
                command: 'start'
              }) as ReturnType<DevelopPreviewLauncher>
          )
        }

        // json mode gets one startup frame, and only once the build and the
        // launch are done. Printed first, it announced a run that then failed.
        if (asJson) {
          printFrame(
            ENVELOPE.ok('start', 'started', {
              projectPath: pathOrRemoteUrl || process.cwd(),
              browser: list[0],
              browsers: list,
              // Run-only serves nothing, so no port is bound. The key stays
              // for readers of the old frame, which echoed the requested one.
              port: null,
              pid: process.pid,
              noBrowser,
              allowControl: Boolean(
                startOptions.allowControl || startOptions.allowEval
              ),
              allowEval: Boolean(startOptions.allowEval)
            })
          )
        }
      }
    )
}
