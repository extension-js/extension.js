//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import {
  BrowserInstallPrivilegeError,
  BrowserNotInstallableError,
  type InstallBrowserTarget,
  isBrowserInstallPrivilegeError,
  isBrowserNotInstallableError,
  normalizeBrowserName
} from './lib/browser-target'

export {
  BrowserInstallPrivilegeError,
  BrowserNotInstallableError,
  isBrowserInstallPrivilegeError,
  isBrowserNotInstallableError,
  normalizeBrowserName
}
export type {InstallBrowserTarget}

import {
  removeBrowserDir,
  resolveBrowserInstallDir,
  resolveBrowsersCacheRoot
} from './lib/cache-root'
import * as messages from './lib/messages'
import {humanLine, humanWarn} from './lib/messaging'
import {
  browserInstallArgs,
  browserInstallCommand,
  browserInstallCwd,
  browserInstallEnv,
  detectSystemEdgeBinary,
  edgeInstallNeedsInteractivePrivilegedSession,
  isEdgePrivilegeEscalationFailure,
  runCommand
} from './lib/runner'

export interface InstallOptions {
  browser: string
  // The executable the install left under destination, or null when nothing
  // usable is there. The launcher's resolver is the one judge of that, so the
  // caller hands it over rather than this package guessing a second time.
  locateInstalledBinary: (
    destination: string,
    browser: InstallBrowserTarget
  ) => string | null
}

export interface UninstallOptions {
  browser?: string
  all?: boolean
}

export interface UninstallResult {
  browser: InstallBrowserTarget
  removed: boolean
  path: string
}

export function getManagedBrowsersCacheRoot(): string {
  return resolveBrowsersCacheRoot()
}

export function getManagedBrowserInstallDir(browser: string): string {
  const target = normalizeBrowserName(browser)

  return resolveBrowserInstallDir(target)
}

// Edge's installer places the browser system-wide, so for edge the system
// binary counts as the install. Anything else has to be under destination.
function findInstalledBinary(
  target: InstallBrowserTarget,
  destination: string,
  locate: InstallOptions['locateInstalledBinary']
): string | null {
  const located = locate(destination, target)
  if (located) return located

  return target === 'edge' ? detectSystemEdgeBinary() : null
}

// A destination with no usable binary is a broken tree, and leaving it behind
// makes the next run stack on it. Nothing usable means nothing to lose.
function discardUnusableInstallTree(destination: string): boolean {
  if (!fs.existsSync(destination)) return false

  fs.rmSync(destination, {recursive: true, force: true})

  return true
}

export async function extensionInstall({
  browser,
  locateInstalledBinary
}: InstallOptions): Promise<void> {
  const target = normalizeBrowserName(browser)
  const destination = resolveBrowserInstallDir(target)

  if (target === 'edge' && edgeInstallNeedsInteractivePrivilegedSession()) {
    throw new BrowserInstallPrivilegeError(
      messages.edgeInstallNeedsInteractivePrivilegedSession()
    )
  }

  humanLine(messages.installingBrowser(target, destination))

  const cmd = browserInstallCommand(target)
  const args = browserInstallArgs(target, destination)
  const env = browserInstallEnv(target, destination)
  const result = await runCommand(cmd, args, {
    cwd: browserInstallCwd(),
    env
  })

  if (result.code !== 0) {
    if (target === 'edge' && isEdgePrivilegeEscalationFailure(result.stderr)) {
      const systemEdge = detectSystemEdgeBinary()

      if (systemEdge) {
        humanWarn(messages.edgeInstallUsingSystemBinary(systemEdge))

        return
      }

      throw new BrowserInstallPrivilegeError(
        messages.edgeInstallNeedsInteractivePrivilegedSession()
      )
    }

    if (!findInstalledBinary(target, destination, locateInstalledBinary)) {
      discardUnusableInstallTree(destination)
    }

    throw new Error(messages.installFailed(target, cmd, args, result))
  }

  // The installer's exit code says it finished, not that the files it left are
  // a browser. An interrupted download exits 0 with a truncated tree.
  if (!findInstalledBinary(target, destination, locateInstalledBinary)) {
    const removed = discardUnusableInstallTree(destination)

    throw new Error(messages.installIncomplete(target, destination, removed))
  }

  humanLine(messages.installSucceeded(target, destination))
}

export async function extensionUninstall({
  browser,
  all
}: UninstallOptions): Promise<UninstallResult[]> {
  const cacheRoot = resolveBrowsersCacheRoot()

  if (!all && !browser) {
    throw new Error(messages.uninstallRequiresTarget())
  }

  // Same comma-list rules as install: "chrome,edge" and "all" expand here so
  // the CLI and direct callers share one acceptance surface.
  const targets: InstallBrowserTarget[] = all
    ? ['chrome', 'chromium', 'edge', 'firefox']
    : String(browser || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((name) => normalizeBrowserName(name))

  if (!all && targets.length === 0) {
    throw new Error(messages.uninstallRequiresTarget())
  }

  humanLine(messages.uninstallingBrowsers(cacheRoot, targets))

  const results: UninstallResult[] = []

  for (const target of targets) {
    const result = removeBrowserDir(target)

    if (result.removed) {
      humanLine(messages.uninstallSucceeded(target, result.path))
    } else {
      humanLine(messages.uninstallNoop(target, result.path))
    }

    results.push({browser: target, removed: result.removed, path: result.path})
  }

  return results
}
