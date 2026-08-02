//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {
  type Browser,
  installTargets,
  validateVendors,
  vendors
} from '../helpers/vendors'

type InstallOptions = {
  browser?: Browser | 'all'
  where?: boolean
  output?: 'pretty' | 'json'
}

type UninstallOptions = {
  all?: boolean
  browser?: string
  where?: boolean
  output?: 'pretty' | 'json'
}

function emit(frame: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(frame))
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
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .action(async (browserArg: string | undefined, options: InstallOptions) => {
      const asJson = options.output === 'json'
      const selectedBrowser = (options.browser || browserArg || 'chromium') as
        | Browser
        | 'all'
      const browserList = installTargets(selectedBrowser)

      let unsupported = ''
      const vendorsAreSupported = validateVendors(
        browserList,
        (invalid, supported) => {
          unsupported = invalid
          if (asJson) return
          // eslint-disable-next-line no-console
          console.error(messages.unsupportedBrowserFlag(invalid, supported))
        }
      )

      if (!vendorsAreSupported) {
        if (asJson) {
          emit(
            ENVELOPE.fail('install', 'usage', {
              code: CODES.E_UNSUPPORTED_BROWSER,
              message: `Unsupported browser: ${unsupported}.`
            })
          )
        }
        await exitAfterDrain(1)
        return
      }

      const {
        extensionInstall,
        getManagedBrowsersCacheRoot,
        getManagedBrowserInstallDir
      } = await import('extension-install')

      if (options.where) {
        const named = Boolean(options.browser || browserArg)
        const paths = named
          ? browserList.map((browser) => getManagedBrowserInstallDir(browser))
          : [getManagedBrowsersCacheRoot()]

        if (asJson) {
          emit(ENVELOPE.ok('install', 'located', {paths}))
        } else {
          for (const location of paths) {
            // eslint-disable-next-line no-console
            console.log(location)
          }
        }
        return
      }

      const installed: string[] = []

      for (const browser of browserList) {
        try {
          await extensionInstall({browser})
          installed.push(browser)
        } catch (error) {
          if (!asJson) throw error

          emit(
            ENVELOPE.fail(
              'install',
              'failed',
              {
                code: CODES.E_BROWSER_DOWNLOAD,
                message: error instanceof Error ? error.message : String(error)
              },
              {hint: `Retry, or install ${browser} manually.`}
            )
          )
          await exitAfterDrain(1)
          return
        }
      }

      if (asJson) {
        emit(ENVELOPE.ok('install', 'installed', {browsers: installed}))
      }
    })

  program
    .command('uninstall')
    .usage('<browser-name> | --all | --where')
    .description(commandDescriptions.uninstall)
    .option('--browser <browser-name>', 'browser to uninstall')
    .option('--all', 'remove all managed browser binaries')
    .option('--where', 'print the resolved managed browser cache root')
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .argument('[browser-name]')
    .action(
      async (
        browserArg: string | undefined,
        {browser, all, where, output}: UninstallOptions
      ) => {
        const asJson = output === 'json'
        const target = browserArg || browser

        const {
          extensionUninstall,
          getManagedBrowsersCacheRoot,
          getManagedBrowserInstallDir
        } = await import('extension-install')

        if (where) {
          let paths: string[]

          if (all) {
            // Mirror install --all's managed set (vendors('all') plus
            // chromium), so install and uninstall cover the same binaries.
            paths = installTargets('all').map((name) =>
              getManagedBrowserInstallDir(name)
            )
          } else if (target) {
            const list = vendors(target as Browser)
            let unsupported = ''
            const vendorsAreSupported = validateVendors(
              list,
              (invalid, supported) => {
                unsupported = invalid
                if (asJson) return
                // eslint-disable-next-line no-console
                console.error(
                  messages.unsupportedBrowserFlag(invalid, supported)
                )
              }
            )

            if (!vendorsAreSupported) {
              if (asJson) {
                emit(
                  ENVELOPE.fail('uninstall', 'usage', {
                    code: CODES.E_UNSUPPORTED_BROWSER,
                    message: `Unsupported browser: ${unsupported}.`
                  })
                )
              }
              await exitAfterDrain(1)
              return
            }

            paths = list.map((name) => getManagedBrowserInstallDir(name))
          } else {
            paths = [getManagedBrowsersCacheRoot()]
          }

          if (asJson) {
            emit(ENVELOPE.ok('uninstall', 'located', {paths}))
          } else {
            for (const location of paths) {
              // eslint-disable-next-line no-console
              console.log(location)
            }
          }
          return
        }

        try {
          await extensionUninstall({
            browser: target,
            all
          } satisfies UninstallOptions)
        } catch (error) {
          if (!asJson) throw error

          emit(
            ENVELOPE.fail('uninstall', 'failed', {
              code: CODES.E_BROWSER_UNINSTALL,
              message: error instanceof Error ? error.message : String(error)
            })
          )
          await exitAfterDrain(1)
          return
        }

        if (asJson) {
          emit(ENVELOPE.ok('uninstall', 'uninstalled', {browser: target, all}))
        }
      }
    )
}
