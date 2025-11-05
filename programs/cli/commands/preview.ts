import type {Command} from 'commander'
import packageJson from '../package.json'
import * as messages from '../cli-lib/messages'
import {requireOrDlx, vendors, validateVendorsOrExit} from '../utils'

type Browser = 'chrome' | 'edge' | 'firefox'
type PreviewOptions = {
  browser?: Browser | 'all'
  profile?: string | boolean
  chromiumBinary?: string
  geckoBinary?: string
  startingUrl?: string
  port?: string | number
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
      '--starting-url <url>',
      'specify the starting URL for the browser. Defaults to `undefined`'
    )
    .option(
      '--port <port>',
      'specify the port to use for the development server. Defaults to `8080`'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chrome', ...previewOptions}: PreviewOptions
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

        await extensionPreview(pathOrRemoteUrl, {
          mode: 'production',
          profile: previewOptions.profile,
          browser: vendor as PreviewOptions['browser'],
          chromiumBinary: (previewOptions as any).chromiumBinary,
          geckoBinary: (previewOptions as any).geckoBinary,
          startingUrl: previewOptions.startingUrl
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
