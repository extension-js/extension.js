//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type Command, Option} from 'commander'
import {launchBrowser} from '../browsers'
import {safariPreflightError} from '../browsers/run-safari/safari-launch'
import {isValidBundleId} from '../browsers/run-safari/safari-launch/safari-config'
import {createSafariPackager} from '../browsers/run-safari/safari-packager'
import {loadExtensionDevelopModule} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'
import {resolveOutputFormat} from '../helpers/output-flag'
import {parseParentPid, setupParentWatchdog} from '../helpers/parent-watchdog'
import {
  type Browser,
  isSafariVendor,
  parseOptionalBoolean,
  validateVendors,
  vendors
} from '../helpers/vendors'
import {describeWaitError, runWaitMode} from './dev-wait'

type DevOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  persistProfile?: boolean
  chromiumBinary?: string
  geckoBinary?: string
  polyfill?: boolean | string
  open?: boolean
  startingUrl?: string
  logLevel?: string
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
  author?: boolean
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
  hint?: string
): never {
  if (asJson) {
    printFrame(ENVELOPE.fail('dev', status, error, hint ? {hint} : {}))
  }
  process.exit(1)
}

// The dev server can move off a busy port after this frame is emitted, so this
// is the requested port. ready.json carries the port it actually bound.
function resolveRequestedPort(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 8080
}

export function registerDevCommand(program: Command) {
  program
    .command('dev')
    .arguments('[project-path|remote-url]')
    .usage('[project-path|remote-url] [options]')
    .description(commandDescriptions.dev)
    .addHelpText(
      'after',
      '\nAdditional options:\n  --no-browser    do not launch the browser (dev server still starts)\n  --no-reload     emit a dev-mode dist without the content-script reload runtime; tabs need manual reload to see changes\n  --wait          wait for ready contract and exit; pair with --output json for machine output\n'
    )
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      '-b, --browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based | safari | webkit-based>',
      'specify a browser/engine to run. Defaults to `chromium`. `safari` builds and opens a Safari app via Xcode (macOS only; no live reload)'
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
      '--safari-binary <path-to-binary>',
      'specify the Safari binary to open after packaging (safari targets only)'
    )
    .option(
      '--app-name <name>',
      'override the Safari app name (safari targets only). Defaults to the manifest `name`'
    )
    .option(
      '--bundle-id <reverse.dns>',
      'set a user-owned Safari bundle identifier (safari targets only). Defaults to a generated dev.extensionjs.* id'
    )
    .option(
      '--macos-only [boolean]',
      'generate a macOS-only Safari Xcode project (safari targets only). Pass `false` for a universal macOS + iOS project. Defaults to `true`',
      parseOptionalBoolean
    )
    .option(
      '--force-regenerate',
      'regenerate the Safari Xcode project even when up to date (safari targets only)'
    )
    .option(
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `true`',
      parseOptionalBoolean
    )
    .option('--no-polyfill', 'disable the cross-browser polyfill')
    .option(
      '--no-open',
      'do not open the browser automatically (default: open)'
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
      '--host <host>',
      'specify the host to bind the dev server to. Use 0.0.0.0 for Docker/devcontainers. Defaults to `127.0.0.1`'
    )
    .option(
      '--public-host <host>',
      'connectable host the browser (HMR + reload bridge) dials when it differs from the bind host (e.g. a remote/devcontainer). Defaults to the bind host, or 127.0.0.1 when bound to 0.0.0.0'
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
      'additionally enable `extension eval` (runs arbitrary code in a context; writes a 0600 session token)'
    )
    .option(
      '--parent-pid <pid>',
      'exit when the given process dies. For wrappers that spawn `extension dev`, so a leaked dev server can never outlive its owner'
    )
    .action(
      async (
        pathOrRemoteUrl: string,
        {browser = 'chromium', ...devOptions}: DevOptions
      ) => {
        if (devOptions.debug || devOptions.author || devOptions.authorMode) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'
          if (!process.env.EXTENSION_VERBOSE)
            process.env.EXTENSION_VERBOSE = '1'
        }

        const asJson = resolveOutputFormat(devOptions) === 'json'

        if (devOptions.parentPid !== undefined) {
          const parentPid = parseParentPid(devOptions.parentPid)
          if (parentPid === undefined) {
            const message = `--parent-pid expects a positive integer pid, got: ${devOptions.parentPid}`
            // eslint-disable-next-line no-console
            console.error(messages.unhandledError(message))
            failAndExit(asJson, 'usage', {
              code: CODES.E_INVALID_OPTION,
              message
            })
          }
          setupParentWatchdog(parentPid)
        }

        const list = vendors(browser)
        let unsupportedBrowser = ''

        const vendorsAreSupported = validateVendors(
          list,
          (invalid, supported) => {
            unsupportedBrowser = invalid
            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          }
        )

        if (!vendorsAreSupported) {
          failAndExit(asJson, 'usage', {
            code: CODES.E_UNSUPPORTED_BROWSER,
            message: `Unsupported browser: ${unsupportedBrowser}`
          })
        }

        // Safari-only options are rejected for other targets so typos don't
        // silently no-op; a malformed bundle id fails before any build.
        const opts = devOptions as unknown as {
          safariBinary?: string
          appName?: string
          bundleId?: string
          macosOnly?: boolean
          forceRegenerate?: boolean
        }
        const safariOnlyFlags = [
          ['--safari-binary', opts.safariBinary],
          ['--app-name', opts.appName],
          ['--bundle-id', opts.bundleId],
          ['--force-regenerate', opts.forceRegenerate]
        ]
          .filter(([, value]) => value !== undefined && value !== false)
          .map(([flag]) => flag as string)

        // --macos-only carries an explicit boolean, so `false` is a real use
        // rather than an unset flag; only `undefined` means it was not passed.
        if (opts.macosOnly !== undefined) safariOnlyFlags.push('--macos-only')

        if (safariOnlyFlags.length > 0 && !list.some(isSafariVendor)) {
          // eslint-disable-next-line no-console
          console.error(messages.safariOnlyOption(safariOnlyFlags))
          failAndExit(asJson, 'usage', {
            code: CODES.E_INVALID_OPTION,
            message: `${safariOnlyFlags.join(', ')} apply to safari targets only.`
          })
        }

        if (opts.bundleId && !isValidBundleId(opts.bundleId)) {
          // eslint-disable-next-line no-console
          console.error(messages.safariInvalidBundleId(opts.bundleId))
          failAndExit(asJson, 'usage', {
            code: CODES.E_INVALID_OPTION,
            message: `--bundle-id expects a reverse-DNS identifier, got: ${opts.bundleId}`
          })
        }

        // Safari: fail fast on a missing toolchain BEFORE the bundle; dev repackages
        // the Safari app on each rebuild.
        if (list.some(isSafariVendor)) {
          const issue = safariPreflightError()

          if (issue) {
            // eslint-disable-next-line no-console
            console.error(issue)
            failAndExit(asJson, 'failed', {
              code: CODES.E_SAFARI_TOOLCHAIN,
              message: String(issue)
            })
          }
        }

        if (devOptions.wait) {
          // The deprecated --wait-format alias already mapped onto --output in
          // resolveOutputFormat, so one flag decides the whole stdout dialect.
          const waitAsJson = asJson
          let waitResult: Awaited<ReturnType<typeof runWaitMode>>

          try {
            waitResult = await runWaitMode({
              command: 'dev',
              pathOrRemoteUrl,
              browsers: list,
              waitTimeout: devOptions.waitTimeout,
              waitFormat: waitAsJson ? 'json' : 'pretty'
            })
          } catch (error) {
            // A throw here used to leave stdout empty, so a machine consumer
            // saw exit 1 and no frame explaining it.
            if (waitAsJson) {
              const failure = describeWaitError(error)
              printFrame(
                ENVELOPE.fail(
                  'dev',
                  failure.status,
                  {code: failure.code, message: failure.message},
                  {hint: failure.hint}
                )
              )
            }

            throw error
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

        const noBrowser = process.env.EXTENSION_CLI_NO_BROWSER === '1'

        // dev never terminates, so json mode gets one startup frame now rather
        // than a result frame that would only arrive when the session dies.
        if (asJson) {
          printFrame(
            ENVELOPE.ok('dev', 'started', {
              projectPath: pathOrRemoteUrl || process.cwd(),
              browser: list[0],
              browsers: list,
              port: resolveRequestedPort(
                (devOptions as unknown as {port?: string | number}).port
              ),
              pid: process.pid,
              noBrowser
            })
          )
        }

        const {extensionDev} = await loadExtensionDevelopModule()

        for (const vendor of list) {
          const logsOption = (devOptions as unknown as {logs?: string}).logs
          const logContextOption = (
            devOptions as unknown as {logContext?: string}
          ).logContext

          const logContexts = parseLogContexts(logContextOption)
          const logLevel = (logsOption ||
            devOptions.logLevel ||
            'off') as string

          const devArgs: Record<string, unknown> = {
            ...devOptions,
            // Under --output json the wrapper catches and frames the failure;
            // extensionDev must reject instead of exiting for that to happen.
            exitOnError: !asJson,
            profile:
              devOptions.profile === false || devOptions.profile === 'false'
                ? false
                : typeof devOptions.profile === 'string'
                  ? devOptions.profile
                  : undefined,
            browser: vendor as DevOptions['browser'],
            chromiumBinary: devOptions.chromiumBinary,
            geckoBinary: devOptions.geckoBinary,
            polyfill:
              devOptions.polyfill?.toString() === 'false' ? false : true,
            noOpen: devOptions.open === false,
            macOsOnly: opts.macosOnly,
            startingUrl: devOptions.startingUrl,
            install: devOptions.install,
            noBrowser,
            extensions: parseExtensionsList(devOptions.extensions),
            logLevel,
            logContexts,
            logFormat: devOptions.logFormat || 'pretty',
            logTimestamps: devOptions.logTimestamps !== false,
            logColor: devOptions.logColor !== false,
            logUrl: devOptions.logUrl,
            logTab: devOptions.logTab,
            // Inject the browser launcher, develop's BrowsersPlugin calls it
            // on first compile; browser lifecycle is managed by the plugin.
            launcher: noBrowser ? undefined : launchBrowser,
            // Inject the Safari packager; SafariDevPlugin calls it on each rebuild (full
            // first, then incremental resync), CLI flags already win over config.
            safariPackager: createSafariPackager({
              browser: vendor as 'safari' | 'webkit-based',
              noOpen: devOptions.open === false
            })
          }

          // extensionDev returns a BuildEmitter from the BrowsersPlugin.
          // Browser launch/reload is handled internally by the plugin.
          try {
            await extensionDev(pathOrRemoteUrl, devArgs)
          } catch (error) {
            if (!asJson) throw error

            // A producer that tagged its failure keeps its code; anything
            // untagged is an internal fault rather than a known class.
            const tagged = (error as {code?: unknown} | null)?.code
            const code =
              typeof tagged === 'string' && tagged in CODES
                ? (tagged as ErrorCode)
                : CODES.E_INTERNAL

            printFrame(
              ENVELOPE.fail(
                'dev',
                'failed',
                {
                  code,
                  message:
                    error instanceof Error ? error.message : String(error)
                },
                {hint: 'Fix the error above and run dev again.'}
              )
            )
            process.exit(1)
          }
        }
      }
    )
}
