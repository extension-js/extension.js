//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import * as messages from '../helpers/messages'
import {runWaitMode} from './dev-wait'
import {commandDescriptions} from '../helpers/messages'
import {
  loadExtensionDevelopModule,
  loadExtensionDevelopPreviewModule
} from '../helpers/extension-develop-runtime'
import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {
  vendors,
  validateVendorsOrExit,
  type Browser,
  parseOptionalBoolean
} from '../helpers/vendors'
import {
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'

type StartOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
  polyfill?: boolean | string
  install?: boolean
  // Internal maintainer flags
  author?: boolean
  authorMode?: boolean
  // Unified logger options (parity with dev/preview)
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
}

export function registerStartCommand(program: Command) {
  program
    .command('start')
    .arguments('[project-path|remote-url]')
    .usage('start [project-path|remote-url] [options]')
    .description(commandDescriptions.start)
    .addHelpText(
      'after',
      '\nAdditional options:\n  --no-browser    do not launch the browser (build still runs)\n  --wait          wait for ready contract and exit\n  --wait-format   pretty|json output for wait mode\n'
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
      'whether or not to apply the cross-browser polyfill. Defaults to `true`'
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
    .option(
      '--port <port>',
      'specify the port to use for the development server. Defaults to `8080`'
    )
    .option(
      '--host <host>',
      'specify the host to bind the dev server to. Use 0.0.0.0 for Docker/devcontainers. Defaults to `127.0.0.1`'
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
      '--wait-format <pretty|json>',
      'output format for --wait results (default: pretty)'
    )
    .option(
      '--author, --author-mode',
      '[experimental] enable maintainer diagnostics (does not affect user runtime logs)'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...startOptions}: StartOptions
    ) {
      if (startOptions.author || startOptions.authorMode) {
        process.env.EXTENSION_AUTHOR_MODE = 'true'
        if (!process.env.EXTENSION_VERBOSE) process.env.EXTENSION_VERBOSE = '1'
      }

      const list = vendors(browser)

      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      if (startOptions.wait) {
        const waitResult = await runWaitMode({
          command: 'start',
          pathOrRemoteUrl,
          browsers: list,
          waitTimeout: startOptions.waitTimeout,
          waitFormat: startOptions.waitFormat
        })

        if (waitResult.format === 'json') {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              ok: true,
              mode: 'wait',
              command: 'start',
              browsers: waitResult.browsers,
              results: waitResult.results
            })
          )
        }
        return
      }

      const {extensionBuild}: {extensionBuild: any} =
        await loadExtensionDevelopModule()

      for (const vendor of list) {
        const logsOption = (startOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          startOptions as unknown as {logContext?: string}
        ).logContext

        const logContexts = parseLogContexts(logContextOption)
        const logLevel = logsOption || startOptions.logLevel || 'off'

        // Phase 1: Build the extension in production mode
        const buildResult = await extensionBuild(pathOrRemoteUrl, {
          browser: vendor as StartOptions['browser'],
          polyfill: startOptions.polyfill?.toString() !== 'false',
          install: startOptions.install,
          extensions: parseExtensionsList(startOptions.extensions),
          silent: true
        })

        const noBrowser = process.env.EXTENSION_CLI_NO_BROWSER === '1'
        if (noBrowser) {
          continue
        }

        // Phase 2: Launch the browser with the built output via browser API.
        // The extensionPreview module is still used under the hood to resolve
        // project structure and extensions-to-load. We call launchBrowser
        // through the preview module which handles all of this.
        const {extensionPreview}: {extensionPreview: any} =
          await loadExtensionDevelopPreviewModule()

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
          (opts: any) => runOnlyPreviewBrowser(opts)
        )
      }
    })
}
