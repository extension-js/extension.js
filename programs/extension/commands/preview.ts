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
import {collectProjectProfile} from '../helpers/project-profile'
import {collectWorkflowProfile} from '../helpers/workflow-profile'
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

export function registerPreviewCommand(program: Command, telemetry: any) {
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

      const cmdStart = Date.now()
      const list = vendors(browser)
      const isRemoteInput =
        typeof pathOrRemoteUrl === 'string' && /^https?:/i.test(pathOrRemoteUrl)
      const projectProfile = collectProjectProfile(
        !isRemoteInput && pathOrRemoteUrl ? pathOrRemoteUrl : process.cwd()
      )
      const workflowProfile = collectWorkflowProfile({
        command: 'preview',
        isMultiBrowser: list.length > 1,
        isRemoteInput: isRemoteInput,
        isNoBrowserMode: process.env.EXTENSION_CLI_NO_BROWSER === '1',
        usesMachineReadableOutput:
          previewOptions.logFormat === 'json' ||
          previewOptions.logFormat === 'ndjson',
        companionExtensionsProvided: Boolean(previewOptions.extensions),
        packageManager: projectProfile?.package_manager,
        frameworkPrimary: projectProfile?.framework_primary,
        hasNextDependency: projectProfile?.has_next_dependency,
        hasTurboDependency: projectProfile?.has_turbo_dependency
      })

      telemetry.track('workflow_profile', {
        command: 'preview',
        ...workflowProfile
      })
      telemetry.track('cli_command_start', {
        command: 'preview',
        vendors: list,
        browser_count: list.length,
        is_multi_browser: list.length > 1,
        is_remote_input: isRemoteInput,
        is_no_browser_mode: process.env.EXTENSION_CLI_NO_BROWSER === '1',
        companion_extensions_provided: Boolean(previewOptions.extensions),
        ...workflowProfile
      })

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
        loadExtensionDevelopPreviewModule()

      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'preview', vendor})

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
        telemetry.track('cli_vendor_finish', {
          command: 'preview',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'preview',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0,
        ...workflowProfile
      })
    })
}
