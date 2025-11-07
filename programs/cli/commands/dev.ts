import type {Command} from 'commander'
import packageJson from '../package.json'
import * as messages from '../cli-lib/messages'
import {requireOrDlx, vendors, validateVendorsOrExit} from '../utils'

type Browser = 'chrome' | 'edge' | 'firefox'
type DevOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  persistProfile?: boolean
  chromiumBinary?: string
  geckoBinary?: string
  polyfill?: boolean | string
  open?: boolean
  startingUrl?: string
  source?: boolean | string
  watchSource?: boolean
  logLevel?: string
  logFormat?: 'pretty' | 'json'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: string | number
}

export function registerDevCommand(program: Command, telemetry: any) {
  program
    .command('dev')
    .arguments('[project-path|remote-url]')
    .usage('dev [project-path|remote-url] [options]')
    .description('Starts the development server (development mode)')
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      '--browser <chrome | edge | firefox>',
      'specify a browser to preview your extension in production mode. Defaults to `chrome`'
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
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `false`'
    )
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
      {browser = 'chrome', ...devOptions}: DevOptions
    ) {
      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'dev',
        vendors: vendors(browser),
        polyfill_used:
          devOptions.polyfill?.toString() === 'false' ? false : true,
        log_level: devOptions.logLevel || 'off',
        log_format: devOptions.logFormat || 'pretty',
        custom_binary_used: Boolean(
          devOptions.chromiumBinary || devOptions.geckoBinary
        )
      })

      const list = vendors(browser)
      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      if (devOptions.source || devOptions.watchSource) {
        const hasExplicitSourceString =
          typeof devOptions.source === 'string' &&
          String(devOptions.source).trim().toLowerCase() !== 'true'

        const hasStartingUrl =
          typeof devOptions.startingUrl === 'string' &&
          String(devOptions.startingUrl).trim().length > 0

        if (!hasExplicitSourceString && !hasStartingUrl) {
          process.exit(1)
        }
      }

      const major = String(packageJson.version).split('.')[0] || '2'
      const {extensionDev} = await requireOrDlx('extension-develop', major)
      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'dev', vendor})

        const logsOption = (devOptions as unknown as {logs?: string}).logs
        const logContextOption = (
          devOptions as unknown as {logContext?: string}
        ).logContext

        const devArgs: any = {
          ...devOptions,
          profile: devOptions.profile,
          browser: vendor as DevOptions['browser'],
          chromiumBinary: devOptions.chromiumBinary,
          geckoBinary: devOptions.geckoBinary,
          polyfill: devOptions.polyfill?.toString() === 'false' ? false : true,
          open: devOptions.open,
          startingUrl: devOptions.startingUrl,
          source: devOptions.source,
          watchSource: devOptions.watchSource,
          logLevel: (logsOption || devOptions.logLevel || 'off') as any,
          logContexts: (() => {
            const raw = (logContextOption ||
              (devOptions as any).logContexts) as string | undefined
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
          })(),
          logFormat: devOptions.logFormat || 'pretty',
          logTimestamps: devOptions.logTimestamps !== false,
          logColor: devOptions.logColor !== false,
          logUrl: devOptions.logUrl,
          logTab: devOptions.logTab
        }

        await extensionDev(pathOrRemoteUrl, devArgs)

        telemetry.track('cli_vendor_finish', {
          command: 'dev',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'dev',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0
      })
    })
}
