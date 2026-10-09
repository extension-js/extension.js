//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Command} from 'commander'
import {resolveManagedBinaryIn} from '../browsers/browsers-lib/output-binaries-resolver'
import {applyManagedFirefoxInstallPolicy} from '../browsers/run-firefox/firefox-launch/managed-update-policy'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {isJsonOutput} from '../helpers/output-flag'
import {
  type Browser,
  firstNonManagedInstallTarget,
  installTargets,
  MANAGED_INSTALL_TARGETS,
  MANAGED_INSTALL_TARGETS_HELP
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

const DEFAULT_INSTALL_TARGET: Browser = 'chromium'

function emit(frame: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(frame))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Mirrors extension-install's isBrowserNotInstallableError without a static
// import so unit tests can mock the package without shipping the type guard.
function isNotInstallableRefusal(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === 'BrowserNotInstallableError' ||
        (error as {code?: string}).code === 'BROWSER_NOT_INSTALLABLE')
  )
}

function isInstallPrivilegeRefusal(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === 'BrowserInstallPrivilegeError' ||
        (error as {code?: string}).code === 'BROWSER_INSTALL_PRIVILEGE')
  )
}

// Retrying in the same session can never work: the fix is a different session
// or a system-wide install, so the hint names those and never says retry.
async function refuseInstallPrivilege(
  browser: string,
  error: unknown,
  asJson: boolean
): Promise<void> {
  const detail = errorText(error)

  if (asJson) {
    emit(
      ENVELOPE.fail(
        'install',
        'failed',
        {
          code: CODES.E_BROWSER_INSTALL_PRIVILEGE,
          message: detail
        },
        {
          hint: `Run it in an interactive terminal where sudo can prompt, or install ${browser} system-wide and run with --browser=${browser}.`
        }
      )
    )
  } else {
    // eslint-disable-next-line no-console
    console.error(messages.browserInstallNeedsPrivilege(browser, detail))
  }

  await exitAfterDrain(1)
}

// Belt-and-suspenders for direct package throws that slip past CLI validation.
async function refuseNotInstallable(
  command: 'install' | 'uninstall',
  error: unknown,
  asJson: boolean
): Promise<void> {
  const message = errorText(error)

  if (asJson) {
    emit(
      ENVELOPE.fail(command, 'usage', {
        code: CODES.E_BROWSER_NOT_INSTALLABLE,
        message
      })
    )
  } else {
    // eslint-disable-next-line no-console
    console.error(message)
  }

  await exitAfterDrain(1)
}

// Three-way gate shared by install and uninstall (including --where), pretty
// and json. Scripts branch on the envelope code alone:
//   unknown name        → E_UNSUPPORTED_BROWSER
//   known, never fetch  → E_BROWSER_NOT_INSTALLABLE
//   managed download    → proceeds (failures become E_BROWSER_DOWNLOAD)
async function refuseIfNotManagedTarget(
  command: 'install' | 'uninstall',
  browserList: string[],
  asJson: boolean
): Promise<boolean> {
  const bad = firstNonManagedInstallTarget(browserList)
  if (!bad) return false

  if (bad.kind === 'not-installable') {
    const message = messages.browserNotInstallablePlain(bad.name)

    if (asJson) {
      emit(
        ENVELOPE.fail(command, 'usage', {
          code: CODES.E_BROWSER_NOT_INSTALLABLE,
          message
        })
      )
    } else {
      // eslint-disable-next-line no-console
      console.error(messages.browserNotInstallable(bad.name))
    }

    await exitAfterDrain(1)

    return true
  }

  // unknown
  if (asJson) {
    emit(
      ENVELOPE.fail(command, 'usage', {
        code: CODES.E_UNSUPPORTED_BROWSER,
        message: `Unsupported browser: ${bad.name}.`
      })
    )
  } else {
    // eslint-disable-next-line no-console
    console.error(
      messages.unsupportedBrowserFlag(bad.name, [...MANAGED_INSTALL_TARGETS])
    )
  }

  await exitAfterDrain(1)

  return true
}

async function refuseDownloadFailed(
  browser: string,
  error: unknown,
  asJson: boolean
): Promise<void> {
  const detail = errorText(error)

  if (asJson) {
    emit(
      ENVELOPE.fail(
        'install',
        'failed',
        {
          code: CODES.E_BROWSER_DOWNLOAD,
          message: detail
        },
        {hint: `Retry, or install ${browser} manually.`}
      )
    )
  } else {
    // eslint-disable-next-line no-console
    console.error(messages.browserDownloadFailed(browser, detail))
  }

  await exitAfterDrain(1)
}

export function registerInstallCommand(program: Command) {
  program
    .command('install')
    .argument(
      '[browser-name]',
      `managed browser to install (default: ${DEFAULT_INSTALL_TARGET})`
    )
    .usage('[browser-name] [options]')
    .description(commandDescriptions.install)
    .option(
      `--browser <${MANAGED_INSTALL_TARGETS_HELP}>`,
      'override the positional browser name. Supports comma-separated values and `all`.'
    )
    .option('--where', 'print the resolved managed browser cache root')
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .action(async (browserArg: string | undefined, options: InstallOptions) => {
      const asJson = isJsonOutput(options)
      const named = Boolean(options.browser || browserArg)
      const selectedBrowser = (options.browser ||
        browserArg ||
        DEFAULT_INSTALL_TARGET) as Browser | 'all'
      const browserList = installTargets(selectedBrowser)

      // --where with no name prints the cache root; skip name validation.
      if (!(options.where && !named)) {
        if (await refuseIfNotManagedTarget('install', browserList, asJson)) {
          return
        }
      }

      // Tells the installer to keep its human lines off stdout, so the
      // envelope is the only document there.
      if (asJson) process.env.EXTENSION_OUTPUT = 'json'

      const {
        extensionInstall,
        getManagedBrowsersCacheRoot,
        getManagedBrowserInstallDir
      } = await import('extension-install')

      if (options.where) {
        let paths: string[]

        try {
          paths = named
            ? browserList.map((browser) => getManagedBrowserInstallDir(browser))
            : [getManagedBrowsersCacheRoot()]
        } catch (error) {
          await refuseNotInstallable('install', error, asJson)

          return
        }

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
          await extensionInstall({
            browser,
            defaulted: !named,
            locateInstalledBinary: resolveManagedBinaryIn
          })

          const installDir = getManagedBrowserInstallDir(browser)

          if (path.basename(installDir) === 'firefox') {
            applyManagedFirefoxInstallPolicy(
              installDir,
              getManagedBrowsersCacheRoot()
            )
          }

          installed.push(browser)
        } catch (error) {
          if (isNotInstallableRefusal(error)) {
            await refuseNotInstallable('install', error, asJson)

            return
          }

          if (isInstallPrivilegeRefusal(error)) {
            await refuseInstallPrivilege(browser, error, asJson)

            return
          }

          await refuseDownloadFailed(browser, error, asJson)

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
    .option(
      `--browser <${MANAGED_INSTALL_TARGETS_HELP}>`,
      'browser(s) to uninstall. Supports comma-separated values and `all`.'
    )
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
        const asJson = isJsonOutput({output})
        const named = Boolean(browserArg || browser)
        // Same resolution path as install: positional/--browser, comma lists,
        // and `all` (via --all or the name itself) expand through installTargets.
        const selected =
          all || browserArg === 'all' || browser === 'all'
            ? 'all'
            : ((browser || browserArg) as Browser | 'all' | undefined)

        if (asJson) process.env.EXTENSION_OUTPUT = 'json'

        const {
          extensionUninstall,
          getManagedBrowsersCacheRoot,
          getManagedBrowserInstallDir
        } = await import('extension-install')

        // --where alone (no name, no --all): print the cache root, no name gate.
        if (where && !named && !all) {
          const paths = [getManagedBrowsersCacheRoot()]

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

        if (!selected) {
          const message =
            'A browser target is required. Pass a browser name, --browser <name>, or --all.'

          if (asJson) {
            emit(
              ENVELOPE.fail('uninstall', 'usage', {
                code: CODES.E_ARGS,
                message
              })
            )
          } else {
            // eslint-disable-next-line no-console
            console.error(message)
          }

          await exitAfterDrain(1)

          return
        }

        const browserList = installTargets(selected)

        if (await refuseIfNotManagedTarget('uninstall', browserList, asJson)) {
          return
        }

        if (where) {
          let paths: string[]

          try {
            paths = browserList.map((name) => getManagedBrowserInstallDir(name))
          } catch (error) {
            await refuseNotInstallable('uninstall', error, asJson)

            return
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

        const removeAll = Boolean(all || selected === 'all')
        let results: Array<{browser: string; removed: boolean; path: string}>

        try {
          results = await extensionUninstall({
            // --all and the name `all` both mean the managed binary set; the
            // package expands that set itself when all is true.
            browser: removeAll ? undefined : browserList.join(','),
            all: removeAll
          })
        } catch (error) {
          if (isNotInstallableRefusal(error)) {
            await refuseNotInstallable('uninstall', error, asJson)

            return
          }

          if (asJson) {
            emit(
              ENVELOPE.fail('uninstall', 'failed', {
                code: CODES.E_BROWSER_UNINSTALL,
                message: errorText(error)
              })
            )
          } else {
            // eslint-disable-next-line no-console
            console.error(errorText(error))
          }

          await exitAfterDrain(1)

          return
        }

        if (asJson) {
          const removedAny = results.some((result) => result.removed)
          const warnings = removedAny
            ? []
            : [
                `${CODES.E_UNINSTALL_NOOP}: Nothing to remove for ${results
                  .map((result) => result.browser)
                  .join(', ')}.`
              ]

          emit(
            ENVELOPE.ok(
              'uninstall',
              removedAny ? 'uninstalled' : 'noop',
              {browsers: browserList, all: removeAll, results},
              {warnings}
            )
          )
        }
      }
    )
}
