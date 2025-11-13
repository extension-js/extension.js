import type {Command} from 'commander'
import packageJson from '../package.json'
import * as messages from '../cli-lib/messages'
import {requireOrDlx, vendors, validateVendorsOrExit} from '../utils'

type Browser = 'chrome' | 'edge' | 'firefox' | 'chromium'
type PreviewOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
  // Source inspection (parity with dev)
  source?: boolean | string
  watchSource?: boolean
  // Unified logger options (parity with dev)
  logLevel?: string
  logFormat?: 'pretty' | 'json'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
}

export function registerPreviewCommand(program: Command, telemetry: any) {
  program
    .command('preview')
    .arguments('[project-name]')
    .usage('preview [path-to-remote-extension] [options]')
    .description('Preview the extension in production mode')
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'specify a browser to preview your extension in production mode. Defaults to `chromium`'
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
      '--log-format <pretty|json>',
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
      '--source [url]',
      '[experimental] opens the provided URL in Chrome and prints the full, live HTML of the page after content scripts are injected'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...previewOptions}: PreviewOptions
    ) {
      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'preview',
        vendors: vendors(browser)
      })

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
      const major = String(packageJson.version).split('.')[0] || '2'
      const {extensionPreview} = await requireOrDlx('extension-develop', major)
      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'preview', vendor})

        const logsOption = (previewOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          previewOptions as unknown as {logContext?: string}
        ).logContext

        const logContexts = (() => {
          const raw = (logContextOption ||
            (previewOptions as any).logContexts) as string | undefined
          if (!raw || String(raw).trim().length === 0) return undefined
          if (String(raw).trim().toLowerCase() === 'all') return undefined
          const allowed = [
            'background',
            'content',
            'page',
            'sidebar',
            'popup',
            'options',
            'devtools'
          ] as const
          type Context = (typeof allowed)[number]
          const values = String(raw)
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0)
            .filter((c: string): c is Context =>
              (allowed as readonly string[]).includes(c)
            )
          return values.length ? values : undefined
        })()

        await extensionPreview(pathOrRemoteUrl, {
          mode: 'production',
          profile: previewOptions.profile,
          browser: vendor as PreviewOptions['browser'],
          chromiumBinary: (previewOptions as any).chromiumBinary,
          geckoBinary: (previewOptions as any).geckoBinary,
          startingUrl: previewOptions.startingUrl,
          port: previewOptions.port,
          source:
            typeof previewOptions.source === 'string'
              ? previewOptions.source
              : (previewOptions.source as any),
          watchSource: previewOptions.watchSource,
          logLevel: (logsOption || previewOptions.logLevel || 'off') as any,
          logContexts,
          logFormat: previewOptions.logFormat || 'pretty',
          logTimestamps: previewOptions.logTimestamps !== false,
          logColor: previewOptions.logColor !== false,
          logUrl: previewOptions.logUrl,
          logTab: previewOptions.logTab
        })
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
        exit_code: process.exitCode ?? 0
      })
    })
}
