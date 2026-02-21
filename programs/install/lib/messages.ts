import colors from 'pintor'
import {InstallBrowserTarget} from './browser-target'

const statusPrefix = colors.brightBlue('►►►')

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

export function installingBrowser(
  browser: InstallBrowserTarget,
  destination: string
): string {
  return `${statusPrefix} Installing ${colors.blue(titleCase(browser))} into ${colors.underline(destination)}...`
}

export function installSucceeded(
  browser: InstallBrowserTarget,
  destination: string
): string {
  return `${statusPrefix} ${colors.green('Installed')} ${colors.blue(titleCase(browser))} in ${colors.underline(destination)}`
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
    `${colors.red('Error')} Failed to install ${colors.blue(titleCase(browser))}.\n` +
    `Command: ${colors.yellow(command)} ${colors.yellow(args.join(' '))}\n` +
    `Exit code: ${colors.yellow(String(code))}` +
    detailSuffix
  )
}

export function edgeInstallNeedsInteractivePrivilegedSession(): string {
  return (
    `${colors.red('Error')} Edge installation on Linux requires a privileged interactive session.\n` +
    `Run this command in a terminal session where sudo can prompt for credentials, or install Edge system-wide with your package manager.\n` +
    `Examples:\n` +
    `- Ubuntu/Debian: ${colors.blue('sudo apt install microsoft-edge-stable')}\n` +
    `- Fedora: ${colors.blue('sudo dnf install microsoft-edge-stable')}\n` +
    `Then run Extension.js with ${colors.blue('--browser=edge')} (or use ${colors.blue('chromium')} when privileged install is unavailable).`
  )
}

export function edgeInstallUsingSystemBinary(path: string): string {
  return (
    `${statusPrefix} ${colors.yellow('Edge channel install was skipped due privilege requirements.')}\n` +
    `${statusPrefix} Using existing system Edge binary at ${colors.underline(path)}.`
  )
}

export function uninstallRequiresTarget(): string {
  return `${colors.red('Error')} Missing browser target. Use --browser <name> or --all.`
}

export function uninstallingBrowsers(
  cacheRoot: string,
  browsers: InstallBrowserTarget[]
): string {
  return `${statusPrefix} Removing browser binaries (${browsers.join(', ')}) from ${colors.underline(cacheRoot)}...`
}

export function uninstallSucceeded(
  browser: InstallBrowserTarget,
  removedPath: string
): string {
  return `${statusPrefix} ${colors.green('Removed')} ${colors.blue(titleCase(browser))} from ${colors.underline(removedPath)}`
}

export function uninstallNoop(
  browser: InstallBrowserTarget,
  checkedPath: string
): string {
  return `${statusPrefix} ${colors.gray(`${titleCase(browser)} is already absent`)} (${colors.underline(checkedPath)})`
}
