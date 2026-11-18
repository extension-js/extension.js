//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {type Command, Option} from 'commander'
import {launchBrowser} from '../browsers'
import {
  SAFARI_APP_ICON_HELP,
  SAFARI_DEVELOPMENT_TEAM_HELP
} from '../browsers/browsers-lib/messages'
import {normalizeProfileOption} from '../browsers/browsers-lib/resolve-profile'
import {safariPreflightError} from '../browsers/run-safari/safari-launch'
import {createSafariPackager} from '../browsers/run-safari/safari-packager'
import {refuseUnlistedChoices} from '../helpers/choice-flags'
import {
  explicitCliValue,
  explicitOptionalBoolean
} from '../helpers/cli-explicit'
import {declaredErrorCode, failureHint} from '../helpers/cli-failure'
import {
  cliGeckoBinary,
  firefoxBinaryAliasOption,
  geckoBinaryOption
} from '../helpers/cli-options'
import {getCliPackageJson} from '../helpers/cli-package-json'
import {resolveConfigBrowser} from '../helpers/config-browser'
import {exitAfterDrain, exitWithFailure} from '../helpers/exit-after-drain'
import {
  type AnyDevelopModule,
  loadExtensionDevelopModule
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
  isReverseDnsBundleId,
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'
import {
  refuseUnreadableOutput,
  resolveOutputFormat
} from '../helpers/output-flag'
import {parseParentPid, setupParentWatchdog} from '../helpers/parent-watchdog'
import {checkProjectCliVersion} from '../helpers/project-cli-version'
import {
  missingProjectFolder,
  missingProjectRefusal
} from '../helpers/project-folder'
import {
  markCommandSessionReady,
  markCommandSessionStart,
  noteRunBrowsers,
  reportCommandFailureNow
} from '../helpers/telemetry-cli'
import {
  BROWSER_TARGETS_HELP,
  type Browser,
  isSafariVendor,
  parseOptionalBoolean,
  unsupportedBrowserMessage,
  validateVendors,
  vendors
} from '../helpers/vendors'
import {describeWaitError, framedWaitFailure, runWaitMode} from './dev-wait'

export type DevOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  firefoxBinary?: string
  safariBinary?: string
  appName?: string
  bundleId?: string
  developmentTeam?: string
  macosOnly?: boolean
  appIcon?: string
  forceRegenerate?: boolean
  enableExtension?: boolean
  polyfill?: boolean | string
  open?: boolean
  port?: string
  host?: string
  publicHost?: string
  allowedHosts?: string
  startingUrl?: string
  logContext?: string
  logs?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  install?: boolean
  extensions?: string
  wait?: boolean
  waitTimeout?: string | number
  waitFormat?: 'pretty' | 'json'
  allowControl?: boolean
  allowEval?: boolean
  parentPid?: string | number
  output?: 'pretty' | 'json'
  debug?: boolean
  authorMode?: boolean
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
  reportFailure: typeof reportCommandFailureNow,
  hint?: string
): never {
  if (asJson) {
    printFrame(ENVELOPE.fail('dev', status, error, hint ? {hint} : {}))
  }

  exitWithFailure(error.code, 1, reportFailure)
}

// The dev server can move off a busy port after this frame is emitted, so this
// is the requested port. ready.json carries the port it actually bound.
function resolveRequestedPort(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 8080
}

// What the action reaches outside this file. Production takes every default.
interface DevCommandDeps {
  loadDevelop?: () => Promise<AnyDevelopModule>
  launcher?: typeof launchBrowser
  safariPreflight?: typeof safariPreflightError
  armParentWatchdog?: typeof setupParentWatchdog
  waitForReady?: typeof runWaitMode
  createPackager?: typeof createSafariPackager
  reportFailure?: typeof reportCommandFailureNow
  noteBrowsers?: typeof noteRunBrowsers
  // Ends the process once stdout is written out, which a bare exit cuts.
  exitDrained?: (code: number) => Promise<void>
}

export function registerDevCommand(
  program: Command,
  {
    loadDevelop = loadExtensionDevelopModule,
    launcher = launchBrowser,
    safariPreflight = safariPreflightError,
    armParentWatchdog = setupParentWatchdog,
    waitForReady = runWaitMode,
    createPackager = createSafariPackager,
    reportFailure = reportCommandFailureNow,
    noteBrowsers = noteRunBrowsers,
    exitDrained = exitAfterDrain
  }: DevCommandDeps = {}
) {
  program
    .command('dev')
    .arguments('[project-path|remote-url]')
    .usage('[project-path|remote-url] [options]')
    .description(commandDescriptions.dev)
    .addHelpText(
      'after',
      '\nAdditional options:\n' +
        '  --no-browser    stop the browser launch, the dev server still starts\n' +
        '  --no-reload     emit a dev-mode dist without the content-script reload runtime, tabs need a manual reload to see changes\n' +
        '  --wait          wait for ready contract and exit, pair with --output json for machine output\n' +
        BROWSER_LAUNCH_HELP_FOOTER
    )
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      `-b, --browser <${BROWSER_TARGETS_HELP}>`,
      'specify a browser/engine to run. Defaults to `chromium`. `safari` builds and opens a Safari app via Xcode (macOS only)'
    )
    .option(
      '--chromium-binary <path-to-binary>',
      'specify a path to the Chromium binary. This option overrides the --browser setting and the binary variables. Without it the managed install runs, then the system install'
    )
    .addOption(geckoBinaryOption())
    .addOption(firefoxBinaryAliasOption())
    .option(
      '--safari-binary <path-to-binary>',
      'specify the Safari binary to open after packaging (safari targets only)'
    )
    .option(
      '--app-name <name>',
      'override the Safari app name (safari targets only). Defaults to the manifest `name`'
    )
    .option(
      '--bundle-id <reverse.dns>',
      'set a user-owned Safari bundle identifier (safari targets only). Defaults to a generated dev.extensionjs.* id shared by every build of the same source, so set your own before the first submission'
    )
    .option('--development-team <id>', SAFARI_DEVELOPMENT_TEAM_HELP)
    .option(
      '--macos-only [boolean]',
      'generate a macOS-only Safari Xcode project (safari targets only). Pass `false` for a universal macOS + iOS project. Defaults to `true`',
      parseOptionalBoolean
    )
    .option('--app-icon <path>', SAFARI_APP_ICON_HELP)
    .option(
      '--force-regenerate',
      'regenerate the Safari Xcode project even when up to date (safari targets only)'
    )
    .option(
      '--enable-extension',
      'turn the extension on in Safari Settings and allow it on other websites through macOS Accessibility, after the one-time grant for your terminal app (safari targets only)'
    )
    .option(
      '--polyfill [boolean]',
      'bundle the cross-browser polyfill, for a Chromium older than 148 (152 with a devtools_page). Defaults to `false`',
      parseOptionalBoolean
    )
    .option('--no-polyfill', 'disable the cross-browser polyfill')
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
      '--host <host>',
      'specify the host to bind the dev server to. Use 0.0.0.0 for Docker/devcontainers, and --allowed-hosts for a name other than localhost. Defaults to `127.0.0.1`'
    )
    .option(
      '--public-host <host>',
      'connectable host the browser (HMR + reload bridge) dials when it differs from the bind host (e.g. a remote/devcontainer). Defaults to the bind host, or 127.0.0.1 when bound to 0.0.0.0'
    )
    .option(
      '--allowed-hosts <list>',
      'comma-separated host names the dev server answers besides localhost, IP addresses and --public-host (docker service names, tunnels, *.local). A leading dot allows every subdomain'
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
    .option(
      '--allow-control',
      'enable the agent-bridge control channel for bounded act (storage/reload/open): see `extension reload|storage|open`'
    )
    .option(
      '--allow-eval',
      'additionally enable `extension eval` (implies --allow-control, runs arbitrary code in a context, writes a 0600 session token)'
    )
    .option(
      '--parent-pid <pid>',
      'exit when the given process dies. For wrappers that spawn `extension dev`, so a leaked dev server can never outlive its owner'
    )
    .hook('preAction', refuseUnreadableOutput({reportFailure}))
    .hook('preAction', refuseUnlistedChoices({reportFailure}))
    .action(
      async (
        pathOrRemoteUrl: string,
        options: DevOptions,
        command: Command
      ) => {
        const {browser: cliBrowser, ...devOptions} = options
        // Only an untyped --browser falls through to extension.config.js
        // commands.dev.browser, then the stock chromium default.
        const browser =
          cliBrowser ??
          ((await resolveConfigBrowser(
            pathOrRemoteUrl || process.cwd(),
            'dev',
            loadDevelop
          )) as DevOptions['browser']) ??
          'chromium'

        if (devOptions.debug || devOptions.authorMode) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'

          if (!process.env.EXTENSION_VERBOSE) {
            process.env.EXTENSION_VERBOSE = '1'
          }
        }

        const asJson = resolveOutputFormat(devOptions) === 'json'
        const fail: (
          status: string,
          error: {code: ErrorCode; message: string}
        ) => never = (status, error) =>
          failAndExit(asJson, status, error, reportFailure)

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
          ['--port', devOptions.port],
          ['--wait-timeout', devOptions.waitTimeout],
          ['--parent-pid', devOptions.parentPid]
        ])

        if (invalidNumber) {
          const message = messages.invalidWholeNumberFlag(...invalidNumber)

          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          fail('usage', {code: CODES.E_INVALID_OPTION, message})
        }

        if (devOptions.waitTimeout !== undefined && !devOptions.wait) {
          const message = messages.waitTimeoutWithoutWait()

          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          fail('usage', {code: CODES.E_INVALID_OPTION, message})
        }

        const parentPid = parseParentPid(devOptions.parentPid)

        if (parentPid !== undefined) {
          armParentWatchdog(parentPid, {
            emitFrame: () => {
              if (!asJson) return

              printFrame(
                ENVELOPE.fail('dev', 'failed', {
                  code: CODES.E_PARENT_GONE,
                  message: `the --parent-pid owner (process ${parentPid}) is gone, so this dev session is shutting down`
                })
              )
            }
          })
        }

        const list = vendors(browser)
        noteBrowsers(list)
        let unsupportedBrowser = ''
        let supportedBrowsers: string[] = []

        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            unsupportedBrowser = invalid
            supportedBrowsers = supported
            // Under --output json the frame is the whole answer.
            if (asJson) return

            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          }
        )

        if (!vendorsAreSupported) {
          fail('usage', {
            code: CODES.E_UNSUPPORTED_BROWSER,
            message: unsupportedBrowserMessage(
              unsupportedBrowser,
              supportedBrowsers
            )
          })
        }

        // Safari-only options are rejected for other targets so typos don't
        // silently no-op; a malformed bundle id fails before any build.
        const safariOnlyFlags = [
          ['--safari-binary', devOptions.safariBinary],
          ['--app-name', devOptions.appName],
          ['--bundle-id', devOptions.bundleId],
          ['--development-team', devOptions.developmentTeam],
          ['--app-icon', devOptions.appIcon],
          ['--force-regenerate', devOptions.forceRegenerate],
          ['--enable-extension', devOptions.enableExtension]
        ]
          .filter(([, value]) => value !== undefined && value !== false)
          .map(([flag]) => flag as string)

        // --macos-only carries an explicit boolean, so `false` is a real use
        // rather than an unset flag; only `undefined` means it was not passed.
        if (devOptions.macosOnly !== undefined) {
          safariOnlyFlags.push('--macos-only')
        }

        if (safariOnlyFlags.length > 0 && !list.some(isSafariVendor)) {
          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.safariOnlyOption(safariOnlyFlags))
          }

          fail('usage', {
            code: CODES.E_INVALID_OPTION,
            message: messages.safariOnlyOptionPlain(safariOnlyFlags)
          })
        }

        if (
          devOptions.bundleId !== undefined &&
          !isReverseDnsBundleId(devOptions.bundleId)
        ) {
          const message = messages.invalidBundleId(devOptions.bundleId)

          if (!asJson) {
            // eslint-disable-next-line no-console
            console.error(messages.usageRefusal(message))
          }

          fail('usage', {code: CODES.E_INVALID_OPTION, message})
        }

        const missingFolder = missingProjectFolder(pathOrRemoteUrl)

        if (missingFolder) {
          const refusal = missingProjectRefusal('dev', missingFolder)

          // eslint-disable-next-line no-console
          if (!asJson) console.error(refusal.stderr)

          failAndExit(
            asJson,
            'usage',
            {code: CODES.E_PROJECT_NOT_FOUND, message: refusal.message},
            reportFailure,
            refusal.hint
          )
        }

        // Safari: fail fast on a missing toolchain BEFORE the bundle; dev repackages
        // the Safari app on each rebuild.
        if (list.some(isSafariVendor)) {
          const issue = safariPreflight()

          if (issue) {
            if (!asJson) {
              // eslint-disable-next-line no-console
              console.error(issue)
            }

            fail('failed', {
              code: CODES.E_SAFARI_TOOLCHAIN,
              message: String(issue)
            })
          }
        }

        if (devOptions.wait) {
          // --wait polls the ready contract and never starts a server, so with
          // --no-browser this run would poll for a file it never writes. Refuse
          // instead of burning the whole --wait-timeout on a certain failure.
          // Only the typed flag counts: commands.dev.noBrowser in
          // extension.config.js belongs to the producer process, and refusing
          // there would break the documented two-process pattern.
          if (process.env.EXTENSION_CLI_NO_BROWSER === '1') {
            if (!asJson) {
              // eslint-disable-next-line no-console
              console.error(messages.noBrowserWithWait('dev'))
            }

            fail('usage', {
              code: CODES.E_INVALID_OPTION,
              message:
                '--no-browser and --wait cannot run in the same process. Run `extension dev --no-browser` in one process and `extension dev --wait` in another.'
            })
          }

          // The deprecated --wait-format alias already mapped onto --output in
          // resolveOutputFormat, so one flag decides the whole stdout dialect.
          const waitAsJson = asJson
          let waitResult: Awaited<ReturnType<typeof runWaitMode>>

          try {
            waitResult = await waitForReady({
              command: 'dev',
              pathOrRemoteUrl,
              browsers: list,
              waitTimeout: devOptions.waitTimeout,
              waitFormat: waitAsJson ? 'json' : 'pretty'
            })
          } catch (error) {
            // A throw here used to leave stdout empty, so a machine consumer
            // saw exit 1 and no frame explaining it.
            const failure = describeWaitError(error)

            if (waitAsJson) {
              printFrame(
                ENVELOPE.fail(
                  'dev',
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
              ENVELOPE.ok('dev', 'ready', {
                mode: 'wait',
                command: 'dev',
                browsers: waitResult.browsers,
                results: waitResult.results
              })
            )
          }

          return
        }

        const noBrowser = await resolveNoBrowser(
          pathOrRemoteUrl || process.cwd(),
          'dev',
          loadDevelop
        )

        // Tells develop to route human lines to stderr, so stdout carries only
        // envelopes and stays parseable one JSON object per line.
        if (asJson) process.env.EXTENSION_OUTPUT = 'json'

        // dev never terminates, so json mode gets one startup frame rather
        // than a result frame that would only arrive when the session dies.
        let startedFramePrinted = false

        const printStartedFrame = () => {
          if (!asJson || startedFramePrinted) return

          startedFramePrinted = true
          printFrame(
            ENVELOPE.ok('dev', 'started', {
              projectPath: pathOrRemoteUrl || process.cwd(),
              browser: list[0],
              browsers: list,
              port: resolveRequestedPort(devOptions.port),
              pid: process.pid,
              noBrowser
            })
          )
        }

        // The run is counted here, at the handoff to the watch loop, because
        // `dev` never returns and the exit that used to report it is a signal.
        markCommandSessionStart('dev')

        // develop exits the process itself on a failure it already printed,
        // which skips every reporting path, so the failure row is sent here.
        const reportExitError = (error: unknown, fallbackCode?: string) => {
          try {
            reportFailure({
              code:
                declaredErrorCode(error) ?? fallbackCode ?? CODES.E_INTERNAL,
              exitCode: 1
            })
          } catch {
            // Best-effort: a report that throws must not keep the process up.
          }

          // Under --output json develop ends the session and exits nothing.
          // Its failed frame is out, so the exit here prints no second one.
          if (asJson) void exitDrained(1)
        }

        const {extensionDev} = await loadDevelop()

        for (const vendor of list) {
          const logsOption = devOptions.logs
          const logContextOption = devOptions.logContext

          const logContexts = parseLogContexts(logContextOption)
          // Only forward logLevel when the user typed --logs. The stock `off`
          // and commands.dev.logLevel live in develop's merge layers.
          const logLevel = logsOption || undefined

          // Pass only values the user typed. Stock defaults and
          // extension.config.js are applied inside extensionDev (defaults,
          // then browser.*, then commands.dev, then CLI), so forcing
          // polyfill/noOpen/log* here would make the shared config decorative.
          const explicitNoOpen = explicitCliValue(
            command,
            'open',
            devOptions.open === false
          )

          // Named key by key: a spread handed develop the CLI-only flags too
          // (--output json, --wait), which it then merged over config values.
          const devArgs: Record<string, unknown> = {
            // Under --output json the wrapper catches and frames the failure;
            // extensionDev must reject instead of exiting for that to happen.
            exitOnError: !asJson,
            profile: normalizeProfileOption(devOptions.profile),
            browser: vendor as DevOptions['browser'],
            chromiumBinary: devOptions.chromiumBinary,
            geckoBinary: cliGeckoBinary(devOptions),
            polyfill: explicitCliValue(
              command,
              'polyfill',
              explicitOptionalBoolean(devOptions.polyfill)
            ),
            noOpen: explicitNoOpen,
            macOsOnly: devOptions.macosOnly,
            startingUrl: devOptions.startingUrl,
            install: devOptions.install,
            noBrowser,
            // The session is usable: counted once, beside its started row.
            onReady: () => markCommandSessionReady('dev'),
            extensions: parseExtensionsList(devOptions.extensions),
            logLevel,
            logContexts,
            logFormat: devOptions.logFormat,
            logTimestamps: explicitCliValue(
              command,
              'logTimestamps',
              devOptions.logTimestamps
            ),
            logColor: explicitCliValue(
              command,
              'logColor',
              devOptions.logColor
            ),
            logUrl: devOptions.logUrl,
            logTab: devOptions.logTab,
            firefoxBinary: devOptions.firefoxBinary,
            safariBinary: devOptions.safariBinary,
            appName: devOptions.appName,
            bundleId: devOptions.bundleId,
            developmentTeam: devOptions.developmentTeam,
            appIcon: devOptions.appIcon,
            forceRegenerate: devOptions.forceRegenerate,
            port: devOptions.port,
            host: devOptions.host,
            publicHost: devOptions.publicHost,
            allowedHosts: devOptions.allowedHosts,
            authorMode: devOptions.authorMode,
            allowControl: devOptions.allowControl,
            allowEval: devOptions.allowEval,
            // Inject the browser launcher, develop's BrowsersPlugin calls it
            // on first compile; browser lifecycle is managed by the plugin.
            launcher: noBrowser ? undefined : launcher,
            // The startup frame waits for the session to exist. Printed up
            // front, it announced a run that a missing manifest then refused.
            onSessionStart: printStartedFrame,
            onExitError: reportExitError,
            // Inject the Safari packager. SafariDevPlugin calls it on each
            // rebuild (full first, then incremental resync). The merged noOpen
            // from develop arrives via packager overrides per call.
            safariPackager: createPackager({
              browser: vendor as 'safari' | 'webkit-based',
              // Open by default in dev when neither flag nor config sets it.
              noOpen: explicitNoOpen ?? false,
              // Dev sessions get the identity card and ready line the other
              // launchers print; build packaging stays quiet.
              announceDevReady: true,
              enableExtension: devOptions.enableExtension === true
            })
          }

          // extensionDev returns a BuildEmitter from the BrowsersPlugin.
          // Browser launch/reload is handled internally by the plugin.
          try {
            await extensionDev(pathOrRemoteUrl, devArgs)
            // A develop that never called back still gets its frame.
            printStartedFrame()
          } catch (error) {
            if (!asJson) throw error

            // A producer that tagged its failure keeps its code; anything
            // untagged is an internal fault rather than a known class.
            const code = declaredErrorCode(error) ?? CODES.E_INTERNAL

            printFrame(
              ENVELOPE.fail(
                'dev',
                'failed',
                {
                  code,
                  message:
                    error instanceof Error ? error.message : String(error)
                },
                {
                  hint:
                    failureHint(code) ??
                    'Fix the error above and run dev again.'
                }
              )
            )

            exitWithFailure(code, 1, reportFailure)
          }
        }
      }
    )
}
