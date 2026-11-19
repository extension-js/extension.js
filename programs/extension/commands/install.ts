//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Command} from 'commander'
import type {UninstallResult} from 'extension-install'
import {systemScanSkipped} from '../browsers/browsers-lib/locator-env'
import {resolveManagedBinaryIn} from '../browsers/browsers-lib/output-binaries-resolver'
import {applyManagedFirefoxInstallPolicy} from '../browsers/run-firefox/firefox-launch/managed-update-policy'
import {
  type ExitAfterDrainDeps,
  exitAfterDrain
} from '../helpers/exit-after-drain'
import * as messages from '../helpers/messages'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {type TelemetryCli, telemetryCli} from '../helpers/telemetry-cli'
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

type InstallTelemetry = ExitAfterDrainDeps['cli'] &
  Pick<TelemetryCli, 'noteInstallTarget'>

export interface InstallCommandDeps {
  telemetry?: InstallTelemetry
}

// Where a refusal prints, and where its code is counted.
interface Reply {
  asJson: boolean
  telemetry: InstallTelemetry
}

// Marked before the drain, so the failure row carries the catalog code and
// not an exit code alone. The drain then finds the run already counted.
async function exitRefused(reply: Reply, code: ErrorCode): Promise<void> {
  try {
    reply.telemetry.markCommandFailure(undefined, {code, exitCode: 1})
  } catch {
    // An exit code is a promise to the caller, a measurement never breaks it.
  }

  await exitAfterDrain(1, {cli: reply.telemetry})
}

// Several names and a comma list are one request. PowerShell hands an
// unquoted chrome,firefox over as two arguments, so both shapes must agree.
function requestedNames(names: readonly string[]): string | undefined {
  const parts = names.flatMap((name) => name.split(','))

  if (parts.length === 0) return undefined
  if (parts.some((part) => part.trim().toLowerCase() === 'all')) return 'all'

  return names.join(',')
}

function emit(frame: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(frame))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type InstallPackage = typeof import('extension-install')

// The install failures that are not a download gone wrong. Each is told by
// the package's own guard, and gets its own code and hint.
const INSTALL_REFUSALS = [
  {
    guard: 'isBrowserInstallTimeoutError',
    code: CODES.E_BROWSER_INSTALL_TIMEOUT,
    hint: 'Set EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, then run the install again.'
  },
  {
    guard: 'isBrowserInstallBusyError',
    code: CODES.E_BROWSER_INSTALL_BUSY,
    hint: 'Wait for the other install of this browser to finish, then run the install again.'
  },
  {
    guard: 'isBrowserCacheRootError',
    code: CODES.E_BROWSER_CACHE_NOT_WRITABLE,
    hint: 'Set EXT_BROWSERS_CACHE_DIR to a folder Extension.js can write to.'
  },
  {
    guard: 'isBrowserInstallForeignFolderError',
    code: CODES.E_BROWSER_FOLDER_FOREIGN,
    hint: 'Set EXT_BROWSERS_CACHE_DIR to a folder that only Extension.js uses.'
  }
] as const

// The guards match by name or code, never instanceof, so an error thrown by
// a second copy of the package is still told apart.
function installRefusalOf(installer: InstallPackage, error: unknown) {
  return INSTALL_REFUSALS.find((refusal) => installer[refusal.guard](error))
}

// What a failed uninstall carries: every target's outcome, removed ones too.
function uninstallResultsOf(error: unknown): UninstallResult[] | null {
  const results = (error as {results?: unknown} | null)?.results

  return Array.isArray(results) ? (results as UninstallResult[]) : null
}

// A run that was told to see no system browser gets the same answer here, so
// install, uninstall and the launcher agree on whether an Edge is present.
function systemEdgeSeam() {
  if (!systemScanSkipped()) return {}

  return {
    systemEdge: {
      exists: () => false,
      lookup: () => null,
      registry: () => null
    }
  }
}

// Nothing was downloaded, so there is nothing to retry: the remedy is the
// runner itself, which the installer's own message already names.
async function refuseInstallerNotFound(
  error: unknown,
  reply: Reply
): Promise<void> {
  const detail = errorText(error)

  if (reply.asJson) {
    emit(
      ENVELOPE.fail(
        'install',
        'failed',
        {
          code: CODES.E_BROWSER_INSTALLER_NOT_FOUND,
          message: detail
        },
        {
          hint: 'Install the package runner the message names, or run this command through a package manager that is installed.'
        }
      )
    )
  } else {
    // eslint-disable-next-line no-console
    console.error(detail)
  }

  await exitRefused(reply, CODES.E_BROWSER_INSTALLER_NOT_FOUND)
}

// Retrying in the same session can never work: the fix is a different session
// or a system-wide install, so the hint names those and never says retry.
async function refuseInstallPrivilege(
  browser: string,
  error: unknown,
  reply: Reply
): Promise<void> {
  const detail = errorText(error)

  if (reply.asJson) {
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

  await exitRefused(reply, CODES.E_BROWSER_INSTALL_PRIVILEGE)
}

// Belt-and-suspenders for direct package throws that slip past CLI validation.
async function refuseNotInstallable(
  command: 'install' | 'uninstall',
  error: unknown,
  reply: Reply
): Promise<void> {
  const message = errorText(error)

  if (reply.asJson) {
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

  await exitRefused(reply, CODES.E_BROWSER_NOT_INSTALLABLE)
}

// Three-way gate shared by install and uninstall (including --where), pretty
// and json. Scripts branch on the envelope code alone:
//   unknown name        → E_UNSUPPORTED_BROWSER
//   known, never fetch  → E_BROWSER_NOT_INSTALLABLE
//   managed download    → proceeds (installer failures become E_BROWSER_DOWNLOAD)
async function refuseIfNotManagedTarget(
  command: 'install' | 'uninstall',
  browserList: string[],
  reply: Reply
): Promise<boolean> {
  const bad = firstNonManagedInstallTarget(browserList)
  if (!bad) return false

  if (bad.kind === 'not-installable') {
    const message = messages.browserNotInstallablePlain(bad.name)

    if (reply.asJson) {
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

    await exitRefused(reply, CODES.E_BROWSER_NOT_INSTALLABLE)

    return true
  }

  // unknown
  if (reply.asJson) {
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

  await exitRefused(reply, CODES.E_UNSUPPORTED_BROWSER)

  return true
}

async function refuseDownloadFailed(
  browser: string,
  error: unknown,
  reply: Reply
): Promise<void> {
  const detail = errorText(error)

  if (reply.asJson) {
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

  await exitRefused(reply, CODES.E_BROWSER_DOWNLOAD)
}

// The package words each of these with its own remedy, so the message is
// printed as it is and never framed as a download to retry.
async function refuseInstall(
  error: unknown,
  reply: Reply,
  code: ErrorCode = CODES.E_BROWSER_DOWNLOAD,
  hint?: string
): Promise<void> {
  const detail = errorText(error)

  if (reply.asJson) {
    emit(
      ENVELOPE.fail(
        'install',
        'failed',
        {code, message: detail},
        hint ? {hint} : {}
      )
    )
  } else {
    // eslint-disable-next-line no-console
    console.error(detail)
  }

  await exitRefused(reply, code)
}

export function registerInstallCommand(
  program: Command,
  {telemetry = telemetryCli}: InstallCommandDeps = {}
) {
  program
    .command('install')
    .argument(
      '[browser-name...]',
      `managed browser to install (default: ${DEFAULT_INSTALL_TARGET})`
    )
    .usage('[browser-name...] [options]')
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
    .hook('preAction', refuseUnreadableOutput())
    .action(async (browserArgs: string[], options: InstallOptions) => {
      const asJson = isJsonOutput(options)
      const reply: Reply = {asJson, telemetry}
      // --browser decides over positional names, as its help says.
      const requested = options.browser
        ? requestedNames([options.browser])
        : requestedNames(browserArgs)
      const named = Boolean(requested)
      const selectedBrowser = (requested || DEFAULT_INSTALL_TARGET) as
        | Browser
        | 'all'
      const browserList = installTargets(selectedBrowser)

      // One browser or all. Several names cannot be told apart in one row.
      telemetry.noteInstallTarget(
        selectedBrowser === 'all' || browserList.length !== 1
          ? selectedBrowser
          : browserList[0]
      )

      // --where with no name prints the cache root; skip name validation.
      if (!(options.where && !named)) {
        if (await refuseIfNotManagedTarget('install', browserList, reply)) {
          return
        }
      }

      // Tells the installer to keep its human lines off stdout, so the
      // envelope is the only document there.
      if (asJson) process.env.EXTENSION_OUTPUT = 'json'

      const installer = await import('extension-install')
      const {
        extensionInstall,
        getManagedBrowsersCacheRoot,
        getManagedBrowserInstallDir
      } = installer

      if (options.where) {
        let paths: string[]

        try {
          paths = named
            ? browserList.map((browser) => getManagedBrowserInstallDir(browser))
            : [getManagedBrowsersCacheRoot()]
        } catch (error) {
          await refuseNotInstallable('install', error, reply)

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
            locateInstalledBinary: resolveManagedBinaryIn,
            ...systemEdgeSeam()
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
          if (installer.isBrowserNotInstallableError(error)) {
            await refuseNotInstallable('install', error, reply)

            return
          }

          if (installer.isBrowserInstallPrivilegeError(error)) {
            await refuseInstallPrivilege(browser, error, reply)

            return
          }

          if (installer.isBrowserInstallerNotFoundError(error)) {
            await refuseInstallerNotFound(error, reply)

            return
          }

          const refusal = installRefusalOf(installer, error)

          if (refusal) {
            await refuseInstall(error, reply, refusal.code, refusal.hint)

            return
          }

          if (installer.isBrowserInstallFailedError(error)) {
            await refuseDownloadFailed(browser, error, reply)

            return
          }

          // Anything else is no download that failed, so it keeps its own words.
          await refuseInstall(error, reply)

          return
        }
      }

      if (asJson) {
        emit(ENVELOPE.ok('install', 'installed', {browsers: installed}))
      }
    })

  program
    .command('uninstall')
    .usage('[browser-name...] | --all | --where')
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
    .hook('preAction', refuseUnreadableOutput())
    .argument('[browser-name...]')
    .action(
      async (
        browserArgs: string[],
        {browser, all, where, output}: UninstallOptions
      ) => {
        const asJson = isJsonOutput({output})
        const reply: Reply = {asJson, telemetry}
        // Same resolution as install: --browser decides over positional
        // names, and `all` (via --all or a name) expands through installTargets.
        const requested = browser
          ? requestedNames([browser])
          : requestedNames(browserArgs)
        const named = Boolean(requested)
        const selected = all
          ? 'all'
          : (requested as Browser | 'all' | undefined)

        if (asJson) process.env.EXTENSION_OUTPUT = 'json'

        const {
          extensionUninstall,
          getManagedBrowsersCacheRoot,
          getManagedBrowserInstallDir,
          isBrowserNotInstallableError
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

          await exitRefused(reply, CODES.E_ARGS)

          return
        }

        const browserList = installTargets(selected)

        if (await refuseIfNotManagedTarget('uninstall', browserList, reply)) {
          return
        }

        if (where) {
          let paths: string[]

          try {
            paths = browserList.map((name) => getManagedBrowserInstallDir(name))
          } catch (error) {
            await refuseNotInstallable('uninstall', error, reply)

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
        let results: UninstallResult[]

        try {
          results = await extensionUninstall({
            // --all and the name `all` both mean the managed binary set; the
            // package expands that set itself when all is true.
            browser: removeAll ? undefined : browserList.join(','),
            all: removeAll,
            ...systemEdgeSeam()
          })
        } catch (error) {
          if (isBrowserNotInstallableError(error)) {
            await refuseNotInstallable('uninstall', error, reply)

            return
          }

          const attempted = uninstallResultsOf(error)

          if (asJson) {
            emit(
              ENVELOPE.fail(
                'uninstall',
                'failed',
                {
                  code: CODES.E_BROWSER_UNINSTALL,
                  message: errorText(error)
                },
                // The targets that were removed stay reported beside the ones
                // that were not, so a script does not remove them twice.
                attempted
                  ? {
                      value: {
                        browsers: browserList,
                        all: removeAll,
                        results: attempted
                      }
                    }
                  : {}
              )
            )
          } else {
            // eslint-disable-next-line no-console
            console.error(errorText(error))
          }

          await exitRefused(reply, CODES.E_BROWSER_UNINSTALL)

          return
        }

        if (asJson) {
          const removedAny = results.some((result) => result.removed)
          const warnings = removedAny
            ? []
            : [
                `${CODES.W_UNINSTALL_NOOP}: Nothing to remove for ${results
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
