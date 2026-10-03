//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import type {InstallBrowserTarget} from './browser-target'
import {fmt, prefix} from './messaging'
import type {CommandResult} from './runner'

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

export function installingBrowser(
  browser: InstallBrowserTarget,
  destination: string
): string {
  return (
    `${prefix('info')} Installing ${colors.blue(titleCase(browser))}…\n` +
    `${fmt.label('PATH')} ${fmt.val(destination)}`
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

export function edgeInstallUsingSystemBinary(path: string): string {
  return (
    `${prefix('warn')} Skipping the Edge channel install, it needs elevated privileges.\n` +
    `${colors.yellow('Using the Edge binary already on this system instead.')}\n` +
    `${fmt.label('PATH')} ${fmt.val(path)}`
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
