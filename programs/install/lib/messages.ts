//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import type {InstallBrowserTarget, UninstallResult} from './browser-target'
import {fmt, prefix} from './messaging'
import type {CommandResult} from './runner'

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

// Edge is placed system-wide, so its line names no cache folder: nothing is
// installed into one.
export function installingBrowser(
  browser: InstallBrowserTarget,
  destination: string,
  defaulted: boolean
): string {
  const why = defaulted ? ', the default when no browser is named' : ''

  if (browser === 'edge') {
    return `${prefix('info')} Installing ${colors.blue('Edge')} system-wide${why}…`
  }

  return (
    `${prefix('info')} Installing ${colors.blue(titleCase(browser))}${why}…\n` +
    `${fmt.label('PATH')} ${fmt.val(destination)}`
  )
}

export function waitingForInstall(
  browser: InstallBrowserTarget,
  pid: number | null
): string {
  const holder = pid === null ? '' : ` (PID ${pid})`

  return (
    `${prefix('info')} Another install of ${colors.blue(titleCase(browser))} ` +
    `is running${holder}. Waiting for it to finish…`
  )
}

export function installSucceeded(
  browser: InstallBrowserTarget,
  destination: string
): string {
  return (
    `${prefix('success')} ${colors.blue(titleCase(browser))} is installed.\n` +
    `${fmt.label('PATH')} ${fmt.val(destination)}`
  )
}

// The launcher looks in fewer places than the install does, so a binary only
// the install found is handed over with the flag that names a binary.
function launcherHint(launcherFinds: boolean): string {
  if (launcherFinds) return ''

  return (
    `\nPass this path with ${colors.blue('--chromium-binary')} to run it, ` +
    `since Extension.js doesn't look there on its own.`
  )
}

// Edge is placed system-wide, so the path named is the binary that was found
// and never the cache folder, which holds no browser.
export function edgeInstalledSystemWide(
  binary: string,
  launcherFinds = true
): string {
  return (
    `${prefix('success')} ${colors.blue('Edge')} is installed system-wide.\n` +
    `${fmt.label('PATH')} ${fmt.val(binary)}` +
    launcherHint(launcherFinds)
  )
}

export function edgeAlreadyInstalled(
  binary: string,
  launcherFinds = true
): string {
  return (
    `${prefix('success')} ${colors.blue('Edge')} is already installed system-wide.\n` +
    `${fmt.label('PATH')} ${fmt.val(binary)}` +
    launcherHint(launcherFinds)
  )
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g

// The thrown messages are plain sentences: they land in error.message under
// --output json, where a glyph or a color code would corrupt the envelope.
export function installFailed(
  browser: InstallBrowserTarget,
  command: string,
  args: string[],
  result: CommandResult
): string {
  const lastLine = String(result.stderr || '')
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()
  const ending =
    result.code === null && result.signal
      ? `was killed by ${result.signal}`
      : `failed with exit code ${String(result.code)}`

  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `The command ${command} ${args.join(' ')} ${ending}. ` +
    `Run it yourself to see the full error.` +
    (lastLine ? ` Its output ended with: ${lastLine}` : '')
  )
}

export function installIncomplete(
  browser: InstallBrowserTarget,
  destination: string,
  removed: boolean
): string {
  const name = titleCase(browser)

  return (
    `Couldn't install ${name}. ` +
    `The installer finished, but ${destination} holds no ${name} binary ` +
    `that is a non-empty executable file, so the download was likely interrupted. ` +
    (removed ? `The incomplete files were removed. ` : '') +
    `Run the install again.`
  )
}

const RUNNER_OWNERS: Record<string, string> = {
  npx: 'npm',
  pnpm: 'pnpm',
  yarn: 'Yarn',
  bunx: 'Bun'
}

export function installerNotFound(
  browser: InstallBrowserTarget,
  command: string
): string {
  const runner = command.replace(/\.cmd$/i, '')

  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `The package runner ${runner} wasn't found on this machine. ` +
    `Install ${RUNNER_OWNERS[runner] || runner}, or run this command through ` +
    `a package manager that is installed.`
  )
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

// The largest unit that keeps the number whole or at one decimal, and never
// "0 seconds": under a second the count stays in milliseconds.
function readableDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`

  const [amount, unit] =
    ms < 120_000 ? [ms / 1000, 'second'] : [ms / 60_000, 'minute']

  return plural(Math.round(amount * 10) / 10, unit)
}

export function installTimedOut(
  browser: InstallBrowserTarget,
  timeoutMs: number,
  removed: boolean
): string {
  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `The installer didn't finish within ${readableDuration(timeoutMs)} and was stopped. ` +
    (removed ? `The incomplete files were removed. ` : '') +
    `Set EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, ` +
    `then run the install again.`
  )
}

export function installInterrupted(
  browser: InstallBrowserTarget,
  signal: string,
  removed: boolean
): string {
  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `The install was interrupted by ${signal} and its installer was stopped. ` +
    (removed ? `The incomplete files were removed. ` : '') +
    `Run the install again.`
  )
}

export function installBusy(
  browser: InstallBrowserTarget,
  pid: number | null,
  timeoutMs: number,
  lockDir: string
): string {
  const holder = pid === null ? '' : ` (PID ${pid})`

  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `Another install of ${titleCase(browser)}${holder} was still running ` +
    `after ${readableDuration(timeoutMs)}. ` +
    `Wait for it to finish and run the install again, ` +
    `or delete ${lockDir} when no such install is running.`
  )
}

export function foreignFolder(
  browser: InstallBrowserTarget,
  destination: string
): string {
  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `The folder ${destination} holds files Extension.js didn't put there, ` +
    `so nothing in it was changed. ` +
    `Set EXT_BROWSERS_CACHE_DIR to a folder that only Extension.js uses.`
  )
}

// Rides behind an install failure, so the failure stays the first sentence.
export function foreignFolderKept(destination: string): string {
  return (
    `The folder ${destination} now holds files Extension.js didn't put there, ` +
    `so nothing in it was removed.`
  )
}

// Rides behind an install failure, so the failure stays the first sentence.
export function brokenTreeNotRemoved(destination: string): string {
  return (
    `The broken files at ${destination} couldn't be removed. ` +
    `Delete that folder before the next install.`
  )
}

// Printed when the install went on with the system Edge, so nothing was
// thrown for the removal to ride behind.
export function brokenTreeLeftBehind(destination: string): string {
  return (
    `${prefix('warn')} The broken Edge files couldn't be removed.\n` +
    `${fmt.label('PATH')} ${fmt.val(destination)}\n` +
    `Delete that folder before the next install.`
  )
}

export function cacheRootUnusable(
  browser: InstallBrowserTarget,
  cacheRoot: string,
  problem: string
): string {
  return (
    `Couldn't install ${titleCase(browser)}. ` +
    `The browser cache path ${cacheRoot} ${problem}. ` +
    `Remove what is at that path, or set EXT_BROWSERS_CACHE_DIR to a folder ` +
    `Extension.js can write to.`
  )
}

export function edgeInstallNeedsInteractivePrivilegedSession(): string {
  return (
    `Edge needs a privileged interactive session on Linux. ` +
    `Run this command in a terminal where sudo can prompt for credentials, ` +
    `or install Edge system-wide with your package manager ` +
    `(sudo apt install microsoft-edge-stable on Ubuntu and Debian, ` +
    `sudo dnf install microsoft-edge-stable on Fedora) ` +
    `and run Extension.js with --browser=edge. ` +
    `Use --browser=chromium when a privileged install is unavailable.`
  )
}

// sudo fails the same way on macOS, where no package manager installs Edge.
export function edgeInstallNeedsAdministratorPassword(): string {
  return (
    `Edge needs an administrator password on macOS. ` +
    `Run this command in a terminal where the installer can ask for it, ` +
    `then run Extension.js with --browser=edge. ` +
    `Use --browser=chromium when an administrator password is unavailable.`
  )
}

// The person was at a terminal sudo could ask on and did not answer, so the
// remedy is to answer next time, not to find another terminal.
export function edgePasswordPromptTimedOut(
  platform: NodeJS.Platform,
  waitMs: number
): string {
  const waited = readableDuration(waitMs)

  if (platform === 'darwin') {
    return (
      `Edge needs an administrator password on macOS, and none was entered ` +
      `within ${waited}, so the install was stopped. ` +
      `Run the install again and enter the password, ` +
      `then run Extension.js with --browser=edge. ` +
      `Use --browser=chromium when an administrator password is unavailable.`
    )
  }

  return (
    `Edge needs your password for sudo on Linux, and none was entered ` +
    `within ${waited}, so the install was stopped. ` +
    `Run the install again and enter the password, ` +
    `or install Edge system-wide with your package manager ` +
    `(sudo apt install microsoft-edge-stable on Ubuntu and Debian, ` +
    `sudo dnf install microsoft-edge-stable on Fedora) ` +
    `and run Extension.js with --browser=edge. ` +
    `Use --browser=chromium when a privileged install is unavailable.`
  )
}

export function edgeInstallUsingSystemBinary(
  path: string,
  launcherFinds = true
): string {
  return (
    `${prefix('warn')} Skipping the Edge channel install, it needs elevated privileges.\n` +
    `${colors.yellow('Using the Edge binary already on this system instead.')}\n` +
    `${fmt.label('PATH')} ${fmt.val(path)}` +
    launcherHint(launcherFinds)
  )
}

export function uninstallRequiresTarget(): string {
  return (
    `A browser target is required. ` +
    `Pass --browser <name>, or --all to remove every browser.`
  )
}

export function uninstallingBrowsers(
  cacheRoot: string,
  browsers: InstallBrowserTarget[]
): string {
  return (
    `${prefix('info')} Removing the browser binaries for ${colors.blue(browsers.join(', '))}…\n` +
    `${fmt.label('PATH')} ${fmt.val(cacheRoot)}`
  )
}

export function uninstallSucceeded(
  browser: InstallBrowserTarget,
  removedPath: string
): string {
  return (
    `${prefix('success')} ${colors.blue(titleCase(browser))} is removed.\n` +
    `${fmt.label('PATH')} ${fmt.val(removedPath)}`
  )
}

export function uninstallNoop(
  browser: InstallBrowserTarget,
  checkedPath: string
): string {
  return (
    `${prefix('info')} ${colors.blue(titleCase(browser))} is already absent.\n` +
    `${fmt.label('PATH')} ${fmt.val(checkedPath)}`
  )
}

export function uninstallSkippedSystemEdge(binary: string): string {
  return (
    `${prefix('info')} ${colors.blue('Edge')} is a system install that Extension.js doesn't remove.\n` +
    `${fmt.label('PATH')} ${fmt.val(binary)}`
  )
}

// The two reasons a folder is left alone without a removal being tried.
export function uninstallReasonForeign(): string {
  return `it holds files Extension.js didn't put there`
}

export function uninstallReasonInstalling(pid: number | null): string {
  return pid === null
    ? 'an install of it is running'
    : `an install of it is running, PID ${pid}`
}

export type UninstallFailureKind = 'removal' | 'foreign' | 'installing'

const UNINSTALL_REMEDIES: Record<UninstallFailureKind, string> = {
  removal:
    'Close any browser running from that folder, then run the uninstall again.',
  foreign:
    'Extension.js removes only the folders it installed, so delete that one yourself if you mean to.',
  installing: 'Wait for the install to finish, then run the uninstall again.'
}

// kinds lines up with the failed results. Each kind is remedied once, and
// only a removal that was tried says the folder is still there.
export function uninstallFailed(
  results: UninstallResult[],
  kinds: UninstallFailureKind[] = []
): string {
  const failed = results.filter((result) => result.outcome === 'failed')
  const kindOf = (index: number) => kinds[index] ?? 'removal'
  const names = failed.map((result) => titleCase(result.browser)).join(', ')
  const evidence = failed
    .map((result, index) =>
      kindOf(index) === 'removal'
        ? `${result.path} is still there (${result.reason}).`
        : `${result.path} was left untouched (${result.reason}).`
    )
    .join(' ')
  const remedies = (Object.keys(UNINSTALL_REMEDIES) as UninstallFailureKind[])
    .filter((kind) => failed.some((_result, index) => kindOf(index) === kind))
    .map((kind) => UNINSTALL_REMEDIES[kind])
    .join(' ')

  return `Couldn't remove ${names}. ${evidence} ${remedies}`
}
