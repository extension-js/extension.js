//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import {commandDescriptions} from '../helpers/messages'
import * as messages from '../helpers/messages'
import {
  type Browser,
  installTargets,
  validateVendorsOrExit,
  vendors
} from '../helpers/vendors'

type InstallOptions = {
  browser?: Browser | 'all'
  where?: boolean
}

type UninstallOptions = {
  all?: boolean
  browser?: string
  where?: boolean
}

export function registerInstallCommand(program: Command) {
  program
    .command('install')
    .arguments('[browser-name]')
    .usage('[browser-name] [options]')
    .description(commandDescriptions.install)
    .option(
      '--browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based | all>',
      'override the positional browser name. Supports comma-separated values and `all`.'
    )
    .option('--where', 'print the resolved managed browser cache root')
    .action(async function (
      browserArg: string | undefined,
      options: InstallOptions
    ) {
      const selectedBrowser = (options.browser || browserArg || 'chromium') as
        | Browser
        | 'all'
      const browserList = installTargets(selectedBrowser)

      validateVendorsOrExit(browserList, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })

      const {
        extensionInstall,
        getManagedBrowsersCacheRoot,
        getManagedBrowserInstallDir
      } = await import('extension-install')

      if (options.where) {
        if (options.browser || browserArg) {
          for (const browser of browserList) {
            // eslint-disable-next-line no-console
            console.log(getManagedBrowserInstallDir(browser))
          }
        } else {
          // eslint-disable-next-line no-console
          console.log(getManagedBrowsersCacheRoot())
        }
        return
      }

      for (const browser of browserList) {
        await extensionInstall({browser})
      }
    })

  program
    .command('uninstall')
    .usage('<browser-name> | --all | --where')
    .description(commandDescriptions.uninstall)
    .option('--browser <browser-name>', 'browser to uninstall')
    .option('--all', 'remove all managed browser binaries')
    .option('--where', 'print the resolved managed browser cache root')
    .argument('[browser-name]')
    .action(async function (
      browserArg: string | undefined,
      {browser, all, where}: UninstallOptions
    ) {
      const target = browserArg || browser

      const {
        extensionUninstall,
        getManagedBrowsersCacheRoot,
        getManagedBrowserInstallDir
      } = await import('extension-install')

      if (where) {
        if (all) {
          for (const browser of ['chrome', 'chromium', 'edge', 'firefox']) {
            // eslint-disable-next-line no-console
            console.log(getManagedBrowserInstallDir(browser))
          }
        } else if (target) {
          const list = vendors(target as Browser)
          validateVendorsOrExit(list, (invalid, supported) => {
            // eslint-disable-next-line no-console
            console.error(messages.unsupportedBrowserFlag(invalid, supported))
          })

          for (const browser of list) {
            // eslint-disable-next-line no-console
            console.log(getManagedBrowserInstallDir(browser))
          }
        } else {
          // eslint-disable-next-line no-console
          console.log(getManagedBrowsersCacheRoot())
        }
        return
      }

      await extensionUninstall({
        browser: target,
        all
      } satisfies UninstallOptions)
    })
}
