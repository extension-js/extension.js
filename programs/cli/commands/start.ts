import type {Command} from 'commander'
import packageJson from '../package.json'
import * as messages from '../cli-lib/messages'
import {requireOrDlx, vendors, validateVendorsOrExit} from '../utils'

type Browser = 'chrome' | 'edge' | 'firefox'
type StartOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
  polyfill?: boolean | string
}

export function registerStartCommand(program: Command, telemetry: any) {
  program
    .command('start')
    .arguments('[project-path|remote-url]')
    .usage('start [project-path|remote-url] [options]')
    .description('Starts the development server (production mode)')
    .option(
      '--profile <path-to-file | boolean>',
      'what path to use for the browser profile. A boolean value of false sets the profile to the default user profile. Defaults to a fresh profile'
    )
    .option(
      '--browser <chrome | edge | firefox>',
      'specify a browser to preview your extension in production mode. Defaults to `chrome`'
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
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chrome', ...startOptions}: StartOptions
    ) {
      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'start',
        vendors: vendors(browser),
        polyfill_used: startOptions.polyfill?.toString() !== 'false'
      })

      const list = vendors(browser)
      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      const major = String(packageJson.version).split('.')[0] || '2'
      const {extensionStart} = await requireOrDlx('extension-develop', major)
      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'start', vendor})

        await extensionStart(pathOrRemoteUrl, {
          mode: 'production',
          profile: startOptions.profile,
          browser: vendor as StartOptions['browser'],
          chromiumBinary: (startOptions as any).chromiumBinary,
          geckoBinary: (startOptions as any).geckoBinary,
          startingUrl: startOptions.startingUrl
        })

        telemetry.track('cli_vendor_finish', {
          command: 'start',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'start',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0
      })
    })
}
