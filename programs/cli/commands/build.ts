import type {Command} from 'commander'
import packageJson from '../package.json'
import * as messages from '../cli-lib/messages'
import {requireOrDlx, vendors, validateVendorsOrExit} from '../utils'

type Browser = 'chrome' | 'edge' | 'firefox' | 'chromium'
type BuildOptions = {
  browser?: Browser | 'all'
  polyfill?: boolean
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  silent?: boolean
}

export function registerBuildCommand(program: Command, telemetry: any) {
  program
    .command('build')
    .arguments('[project-name]')
    .usage('build [path-to-remote-extension] [options]')
    .description('Builds the extension for production')
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'specify a browser to preview your extension in production mode. Defaults to `chromium`'
    )
    .option(
      '--polyfill [boolean]',
      'whether or not to apply the cross-browser polyfill. Defaults to `false`'
    )
    .option(
      '--zip [boolean]',
      'whether or not to compress the extension into a ZIP file. Defaults to `false`'
    )
    .option(
      '--zip-source [boolean]',
      'whether or not to include the source files in the ZIP file. Defaults to `false`'
    )
    .option(
      '--zip-filename <string>',
      'specify the name of the ZIP file. Defaults to the extension name and version'
    )
    .option(
      '--silent [boolean]',
      'whether or not to open the browser automatically. Defaults to `false`'
    )
    .action(async function (
      pathOrRemoteUrl: string,
      {browser = 'chromium', ...buildOptions}: BuildOptions
    ) {
      const cmdStart = Date.now()
      telemetry.track('cli_command_start', {
        command: 'build',
        vendors: vendors(browser),
        polyfill_used: buildOptions.polyfill || false,
        zip: buildOptions.zip || false,
        zip_source: buildOptions.zipSource || false
      })

      const list = vendors(browser)
      validateVendorsOrExit(list, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      const major = String(packageJson.version).split('.')[0] || '2'
      const {extensionBuild} = await requireOrDlx('extension-develop', major)
      for (const vendor of list) {
        const vendorStart = Date.now()
        telemetry.track('cli_vendor_start', {command: 'build', vendor})

        const buildSummary = await extensionBuild(pathOrRemoteUrl, {
          browser: vendor as BuildOptions['browser'],
          polyfill: buildOptions.polyfill,
          zip: buildOptions.zip,
          zipSource: buildOptions.zipSource,
          zipFilename: buildOptions.zipFilename,
          silent: buildOptions.silent
        })
        telemetry.track('cli_build_summary', {
          ...buildSummary
        })
        telemetry.track('cli_vendor_finish', {
          command: 'build',
          vendor,
          duration_ms: Date.now() - vendorStart
        })
      }

      telemetry.track('cli_command_finish', {
        command: 'build',
        duration_ms: Date.now() - cmdStart,
        success: process.exitCode === 0 || process.exitCode == null,
        exit_code: process.exitCode ?? 0
      })
    })
}
