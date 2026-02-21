//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Command} from 'commander'
import path from 'node:path'
import {commandDescriptions} from '../cli-lib/messages'
import * as messages from '../cli-lib/messages'
import {type Browser, validateVendorsOrExit, vendors} from '../utils'

type InstallOptions = {
  browser?: Browser | 'all'
  where?: boolean
}

type UninstallOptions = {
  all?: boolean
  browser?: string
  where?: boolean
}

function resolveManagedBrowsersCacheRoot(): string {
  const explicit = String(process.env.EXT_BROWSERS_CACHE_DIR || '').trim()
  if (explicit) return path.resolve(explicit)

  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  if (isWin) {
    const local = String(process.env.LOCALAPPDATA || '').trim()
    if (local) return path.join(local, 'extension.js', 'browsers')
    const userProfile = String(process.env.USERPROFILE || '').trim()
    if (userProfile) {
      return path.join(
        userProfile,
        'AppData',
        'Local',
        'extension.js',
        'browsers'
      )
    }
    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  if (isMac) {
    const home = String(process.env.HOME || '').trim()
    if (home)
      return path.join(home, 'Library', 'Caches', 'extension.js', 'browsers')
    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  const xdg = String(process.env.XDG_CACHE_HOME || '').trim()
  if (xdg) return path.join(xdg, 'extension.js', 'browsers')
  const home = String(process.env.HOME || '').trim()
  if (home) return path.join(home, '.cache', 'extension.js', 'browsers')
  return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
}

function normalizeInstallVendor(
  vendor: string
): 'chrome' | 'chromium' | 'edge' | 'firefox' {
  const value = String(vendor).trim().toLowerCase()
  if (value === 'chromium-based') return 'chromium'
  if (value === 'gecko-based' || value === 'firefox-based') return 'firefox'
  if (
    value === 'chrome' ||
    value === 'chromium' ||
    value === 'edge' ||
    value === 'firefox'
  ) {
    return value
  }
  return 'chromium'
}

export function registerInstallCommand(program: Command, telemetry: any) {
  program
    .command('install')
    .arguments('[browser-name]')
    .usage('install [browser-name] [--browser <name>] [--where]')
    .description(commandDescriptions.install)
    .option(
      '--browser <chrome | chromium | edge | firefox | chromium-based | gecko-based | firefox-based | all>',
      'specify browser(s) to install. Supports comma-separated values and `all`.'
    )
    .option('--where', 'print the resolved managed browser cache root')
    .action(async function (
      browserArg: string | undefined,
      options: InstallOptions
    ) {
      const startedAt = Date.now()
      const selectedBrowser = (options.browser || browserArg || 'chromium') as
        | Browser
        | 'all'
      const browserList = vendors(selectedBrowser)
      validateVendorsOrExit(browserList, (invalid, supported) => {
        // eslint-disable-next-line no-console
        console.error(messages.unsupportedBrowserFlag(invalid, supported))
      })
      telemetry.track('cli_command_start', {
        command: 'install',
        vendors: browserList,
        where: Boolean(options.where)
      })

      try {
        if (options.where) {
          const root = resolveManagedBrowsersCacheRoot()
          if (options.browser || browserArg) {
            for (const browser of browserList) {
              // eslint-disable-next-line no-console
              console.log(path.join(root, normalizeInstallVendor(browser)))
            }
          } else {
            // eslint-disable-next-line no-console
            console.log(root)
          }
        } else {
          const {extensionInstall} = await import('extension-install')
          for (const browser of browserList) {
            await extensionInstall({browser})
          }
        }

        telemetry.track('cli_command_finish', {
          command: 'install',
          duration_ms: Date.now() - startedAt,
          success: true,
          exit_code: 0
        })
      } catch (err) {
        telemetry.track('cli_command_finish', {
          command: 'install',
          duration_ms: Date.now() - startedAt,
          success: false,
          exit_code: 1
        })
        throw err
      }
    })

  program
    .command('uninstall')
    .usage('uninstall <browser-name> | uninstall --all | uninstall --where')
    .description(commandDescriptions.uninstall)
    .option('--browser <browser-name>', 'browser to uninstall')
    .option('--all', 'remove all managed browser binaries')
    .option('--where', 'print the resolved managed browser cache root')
    .argument('[browser-name]')
    .action(async function (
      browserArg: string | undefined,
      {browser, all, where}: UninstallOptions
    ) {
      const startedAt = Date.now()
      const target = browserArg || browser
      telemetry.track('cli_command_start', {
        command: 'uninstall',
        browser: target,
        all: Boolean(all),
        where: Boolean(where)
      })

      try {
        if (where) {
          const root = resolveManagedBrowsersCacheRoot()
          if (all) {
            for (const browser of ['chrome', 'chromium', 'edge', 'firefox']) {
              // eslint-disable-next-line no-console
              console.log(path.join(root, browser))
            }
          } else if (target) {
            const list = vendors(target as Browser)
            validateVendorsOrExit(list, (invalid, supported) => {
              // eslint-disable-next-line no-console
              console.error(messages.unsupportedBrowserFlag(invalid, supported))
            })

            for (const browser of list) {
              // eslint-disable-next-line no-console
              console.log(path.join(root, normalizeInstallVendor(browser)))
            }
          } else {
            // eslint-disable-next-line no-console
            console.log(root)
          }
        } else {
          const {extensionUninstall} = await import('extension-install')
          await extensionUninstall({
            browser: target,
            all
          } satisfies UninstallOptions)
        }

        telemetry.track('cli_command_finish', {
          command: 'uninstall',
          duration_ms: Date.now() - startedAt,
          success: true,
          exit_code: 0
        })
      } catch (err) {
        telemetry.track('cli_command_finish', {
          command: 'uninstall',
          duration_ms: Date.now() - startedAt,
          success: false,
          exit_code: 1
        })
        throw err
      }
    })
}
