//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {loadExtensionDevelopPreviewModule} from '../helpers/extension-develop-runtime'
import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {vendors, validateVendorsOrExit, type Browser} from '../helpers/vendors'
import {
  parseExtensionsList,
  parseLogContexts
} from '../helpers/normalize-options'

type PreviewOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
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

export function registerPreviewCommand(program: Command) {
  program
    .command('preview')
    .arguments('[project-name]')
    .usage('preview [path-to-remote-extension] [options]')
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

      const {extensionPreview}: {extensionPreview: any} =
        await loadExtensionDevelopPreviewModule()

      for (const vendor of list) {
        const logsOption = (previewOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          previewOptions as unknown as {logContext?: string}
        ).logContext

        const logContexts = parseLogContexts(logContextOption)

        await extensionPreview(
          pathOrRemoteUrl,
          {
            mode: 'production',
            profile: previewOptions.profile,
            browser: vendor as PreviewOptions['browser'],
            chromiumBinary: previewOptions.chromiumBinary,
            geckoBinary: previewOptions.geckoBinary,
            startingUrl: previewOptions.startingUrl,
            port: previewOptions.port,
            noBrowser: process.env.EXTENSION_CLI_NO_BROWSER === '1',
            extensions: parseExtensionsList(previewOptions.extensions),
            logLevel: logsOption || previewOptions.logLevel || 'off',
            logContexts,
            logFormat: previewOptions.logFormat || 'pretty',
            logTimestamps: previewOptions.logTimestamps !== false,
            logColor: previewOptions.logColor !== false,
            logUrl: previewOptions.logUrl,
            logTab: previewOptions.logTab
          },
          // Browser launcher callback — runs browser code from extension/browser/
          // without pulling rspack into the preview path
          (opts: any) => runOnlyPreviewBrowser(opts)
        )
      }
    })
}
