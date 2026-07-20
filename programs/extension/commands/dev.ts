//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'
import {launchBrowser} from '../browsers'
import {
  packageSafariExtension,
  safariPreflightError
} from '../browsers/run-safari/safari-launch'
import {isValidBundleId} from '../browsers/run-safari/safari-launch/safari-config'
import {loadExtensionDevelopModule} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'
import {parseParentPid, setupParentWatchdog} from '../helpers/parent-watchdog'
import {
  type Browser,
  isSafariVendor,
  parseOptionalBoolean,
  validateVendorsOrExit,
  vendors
} from '../helpers/vendors'
import {runWaitMode} from './dev-wait'

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
}

export function registerDevCommand(program: Command) {
  program
    .command('dev')
    .arguments('[project-path|remote-url]')
    .usage('[project-path|remote-url] [options]')
    .description(commandDescriptions.dev)
    .addHelpText(
      'after',
      '\nAdditional options:\n  --no-browser    do not launch the browser (dev server still starts)\n  --no-reload     emit a dev-mode dist without the content-script reload runtime; tabs need manual reload to see changes\n  --wait          wait for ready contract and exit\n  --wait-format   pretty|json output for wait mode\n'
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
      '--wait-format <pretty|json>',
      'output format for --wait results (default: pretty)'
    )
    .option(
      '--author, --author-mode',
      '[internal] enable maintainer diagnostics (does not affect user runtime logs)'
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
        if ((devOptions as any).author || (devOptions as any)['authorMode']) {
          process.env.EXTENSION_AUTHOR_MODE = 'true'
          if (!process.env.EXTENSION_VERBOSE)
            process.env.EXTENSION_VERBOSE = '1'
        }

        if (devOptions.parentPid !== undefined) {
          const parentPid = parseParentPid(devOptions.parentPid)
          if (parentPid === undefined) {
            // eslint-disable-next-line no-console
            console.error(
              messages.unhandledError(
                `--parent-pid expects a positive integer pid, got: ${devOptions.parentPid}`
              )
            )
            process.exit(1)
          }
          setupParentWatchdog(parentPid)
        }

        const list = vendors(browser)

        validateVendorsOrExit(list, (invalid, supported) => {
          // eslint-disable-next-line no-console
          console.error(messages.unsupportedBrowserFlag(invalid, supported))
        })

        // Safari-only options are rejected for other targets so typos don't
        // silently no-op; a malformed bundle id fails before any build.
        const opts = devOptions as unknown as {
          safariBinary?: string
          appName?: string
          bundleId?: string
          forceRegenerate?: boolean
        }
        const safariOnlyFlags = [
          ['--safari-binary', opts.safariBinary],
          ['--app-name', opts.appName],
          ['--bundle-id', opts.bundleId],
          ['--force-regenerate', opts.forceRegenerate]
        ].filter(([, value]) => value !== undefined && value !== false)

        if (safariOnlyFlags.length > 0 && !list.some(isSafariVendor)) {
          // eslint-disable-next-line no-console
          console.error(
            messages.safariOnlyOption(
              safariOnlyFlags.map(([flag]) => flag as string)
            )
          )
          process.exit(1)
        }

        if (opts.bundleId && !isValidBundleId(opts.bundleId)) {
          // eslint-disable-next-line no-console
          console.error(messages.safariInvalidBundleId(opts.bundleId))
          process.exit(1)
        }

        // Safari: fail fast on a missing toolchain *before* the bundle, so the
        // user isn't surprised after a build. (dev rides the watch compiler and
        // repackages the Safari app on each rebuild)
        if (list.some(isSafariVendor)) {
          const issue = safariPreflightError()

          if (issue) {
            // eslint-disable-next-line no-console
            console.error(issue)
            process.exit(1)
          }
        }

        if (devOptions.wait) {
          const waitResult = await runWaitMode({
            command: 'dev',
            pathOrRemoteUrl,
            browsers: list,
            waitTimeout: devOptions.waitTimeout,
            waitFormat: devOptions.waitFormat
          })

          if (waitResult.format === 'json') {
            // eslint-disable-next-line no-console
            console.log(
              JSON.stringify({
                ok: true,
                mode: 'wait',
                command: 'dev',
                browsers: waitResult.browsers,
                results: waitResult.results
              })
            )
          }
          return
        }

        const {extensionDev}: {extensionDev: any} =
          await loadExtensionDevelopModule()
        const noBrowser = process.env.EXTENSION_CLI_NO_BROWSER === '1'

        for (const vendor of list) {
          const logsOption = (devOptions as unknown as {logs?: string}).logs
          const logContextOption = (
            devOptions as unknown as {logContext?: string}
          ).logContext

          const logContexts = parseLogContexts(logContextOption)
          const logLevel = (logsOption ||
            devOptions.logLevel ||
            'off') as string

          const devArgs: any = {
            ...devOptions,
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
            // Inject the Safari packager, SafariDevPlugin calls it on each
            // rebuild (full first, then incremental resync). Identity overrides
            // arrive from develop with CLI flags already winning over
            // extension.config.js `browser.safari`.
            safariPackager: async (
              distPath: string,
              mode: 'full' | 'resync',
              overrides?: Record<string, unknown>
            ) => {
              await packageSafariExtension(
                {
                  extension: [distPath],
                  browser: vendor as Browser,
                  noOpen: devOptions.open === false,
                  dryRun: false,
                  ...overrides
                },
                distPath,
                undefined,
                mode
              )
            }
          }

          // extensionDev returns a BuildEmitter from the BrowsersPlugin.
          // Browser launch/reload is handled internally by the plugin.
          await extensionDev(pathOrRemoteUrl, devArgs)
        }
      }
    )
}
