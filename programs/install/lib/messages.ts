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

export function installFailed(
  browser: InstallBrowserTarget,
  command: string,
  args: string[],
  code: number | null,
  stderr: string
): string {
  const details = String(stderr || '').trim()
  const detailSuffix = details ? `\n${colors.red(details)}` : ''
  return (
    `${prefix('error')} Couldn't install ${colors.blue(titleCase(browser))}.\n` +
    `${colors.red('The command')} ${colors.yellow(command)} ${colors.yellow(args.join(' '))} ` +
    `${colors.red(`failed with exit code ${colors.yellow(String(code))}`)}${colors.red('.')}\n` +
    `${colors.red('Run it yourself to see the full error.')}` +
    detailSuffix
  )
}

export function edgeInstallNeedsInteractivePrivilegedSession(): string {
  return (
    `${prefix('error')} Edge needs a privileged interactive session on Linux.\n` +
    `${colors.red('Run this command in a terminal where sudo can prompt for credentials.')}\n` +
    `${colors.red('Or install Edge system-wide with your package manager.')}\n` +
    `  ${colors.gray('-')} Ubuntu/Debian: ${colors.blue('sudo apt install microsoft-edge-stable')}\n` +
    `  ${colors.gray('-')} Fedora: ${colors.blue('sudo dnf install microsoft-edge-stable')}\n` +
    `${colors.red('Then run Extension.js with')} ${colors.blue('--browser=edge')}${colors.red('.')}\n` +
    `${colors.red('Use')} ${colors.blue('--browser=chromium')} ${colors.red('when a privileged install is unavailable.')}`
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
    `${prefix('error')} A browser target is required.\n` +
    `${colors.red('Pass')} ${colors.blue('--browser <name>')}${colors.red(', or')} ${colors.blue('--all')} ${colors.red('to remove every browser.')}`
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
