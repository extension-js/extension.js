//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type Command, Option} from 'commander'
import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {markErrorFramed} from '../helpers/cli-failure'
import {
  loadExtensionDevelopModule,
  loadExtensionDevelopPreviewModule
} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {resolveNoBrowser} from '../helpers/no-browser'
import {
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'
import {resolveOutputFormat} from '../helpers/output-flag'
import {
  type Browser,
  isSafariVendor,
  parseOptionalBoolean,
  validateVendors,
  vendors
} from '../helpers/vendors'
import {describeWaitError, runWaitMode} from './dev-wait'

type StartOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
  host?: string
  polyfill?: boolean | string
  install?: boolean
  debug?: boolean
  author?: boolean
  authorMode?: boolean
  logLevel?: string
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
  extensions?: string
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
  process.exit(1)
}

// The preview server can move off a busy port after this frame is emitted, so
// this is the requested port. ready.json carries the port it actually bound.
function resolveRequestedPort(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 8080
}

export function registerStartCommand(program: Command) {
  program
    .command('start')
    .arguments('[project-path|remote-url]')
    .usage('[project-path|remote-url] [options]')
    .description(commandDescriptions.start)
    .addHelpText(
      'after',
      '\nAdditional options:\n  --no-browser    do not launch the browser (build still runs)\n  --wait          wait for ready contract and exit; pair with --output json for machine output\n'
    )
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
      'whether or not to apply the cross-browser polyfill. Defaults to `true`',
      parseOptionalBoolean
    )
    .option('--no-polyfill', 'disable the cross-browser polyfill')
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
      '[experimental] install project dependencies when missing',
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
    .action(
      async (
        pathOrRemoteUrl: string,
        {browser = 'chromium', ...startOptions}: StartOptions
      ) => {
        if (
          startOptions.debug ||
          startOptions.author ||
          startOptions.authorMode
        ) {
          process.env.EXTENSION_DEBUG = '1'
          // Alias kept for one minor: extension-develop still reads the old name.
          process.env.EXTENSION_AUTHOR_MODE = 'true'
          if (!process.env.EXTENSION_VERBOSE)
            process.env.EXTENSION_VERBOSE = '1'
        }

        const asJson = resolveOutputFormat(startOptions) === 'json'
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

        if (list.some(isSafariVendor)) {
          console.error(messages.safariCommandNotSupported('start'))
          failAndExit(asJson, 'usage', {
            code: CODES.E_UNSUPPORTED_BROWSER,
            message: 'Safari targets are not supported by start.'
          })
        }

        if (startOptions.wait) {
          // The deprecated --wait-format alias already mapped onto --output in
          // resolveOutputFormat, so one flag decides the whole stdout dialect.
          const waitAsJson = asJson
          let waitResult: Awaited<ReturnType<typeof runWaitMode>>

          try {
            waitResult = await runWaitMode({
              command: 'start',
              pathOrRemoteUrl,
              browsers: list,
              waitTimeout: startOptions.waitTimeout,
              waitFormat: waitAsJson ? 'json' : 'pretty'
            })
          } catch (error) {
            // A throw here used to leave stdout empty, so a machine consumer
            // saw exit 1 and no frame explaining it.
            if (waitAsJson) {
              const failure = describeWaitError(error)
              printFrame(
                ENVELOPE.fail(
                  'start',
                  failure.status,
                  {code: failure.code, message: failure.message},
                  {hint: failure.hint}
                )
              )
              markErrorFramed(error)
            }

            throw error
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

        // start keeps running behind the launched browser, so json mode gets one
        // startup frame now rather than a result frame at session end.
        if (asJson) {
          printFrame(
            ENVELOPE.ok('start', 'started', {
              projectPath: pathOrRemoteUrl || process.cwd(),
              browser: list[0],
              browsers: list,
              port: resolveRequestedPort(startOptions.port),
              pid: process.pid,
              noBrowser: await resolveNoBrowser(
                pathOrRemoteUrl || process.cwd(),
                'start'
              )
            })
          )
        }

        const {extensionBuild} = await loadExtensionDevelopModule()

        for (const vendor of list) {
          const logsOption = (startOptions as unknown as {logs?: string}).logs
          const logContextOption = (
            startOptions as unknown as {logContext?: string}
          ).logContext

          const logContexts = parseLogContexts(logContextOption)
          const logLevel = logsOption || startOptions.logLevel || 'off'

          try {
            await extensionBuild(pathOrRemoteUrl, {
              browser: vendor as StartOptions['browser'],
              // CLI surface: a failed build ends this process with the clean
              // error line. Library imports of extensionBuild reject instead.
              // Under --output json we catch instead, so the failure can be
              // reported as one envelope rather than a bare exit code.
              exitOnError: !asJson,
              // The build-phase receipt should name the command the user ran.
              metadataCommand: 'start',
              polyfill: startOptions.polyfill?.toString() !== 'false',
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
                  code: CODES.E_COMPILE,
                  message:
                    error instanceof Error ? error.message : String(error)
                },
                {hint: 'Fix the error above and run start again.'}
              )
            )
            process.exit(1)
          }

          const noBrowser = await resolveNoBrowser(
            pathOrRemoteUrl || process.cwd(),
            'start'
          )
          if (noBrowser) {
            continue
          }

          // Launch the browser through the preview module, which resolves the
          // project structure and extensions-to-load.
          const {extensionPreview} = await loadExtensionDevelopPreviewModule()

          await extensionPreview(
            pathOrRemoteUrl,
            {
              mode: 'production',
              profile: startOptions.profile,
              browser: vendor as StartOptions['browser'],
              chromiumBinary: startOptions.chromiumBinary,
              geckoBinary: startOptions.geckoBinary,
              startingUrl: startOptions.startingUrl,
              port: startOptions.port,
              host: startOptions.host,
              noBrowser: false,
              extensions: parseExtensionsList(startOptions.extensions),
              metadataCommand: 'start',
              logLevel,
              logContexts,
              logFormat: startOptions.logFormat || 'pretty',
              logTimestamps: startOptions.logTimestamps !== false,
              logColor: startOptions.logColor !== false,
              logUrl: startOptions.logUrl,
              logTab: startOptions.logTab
            },
            (opts: Parameters<typeof runOnlyPreviewBrowser>[0]) =>
              runOnlyPreviewBrowser(opts)
          )
        }
      }
    )
}
