//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as messages from './lib/messages'
import {
  normalizeBrowserName,
  type InstallBrowserTarget
} from './lib/browser-target'
import {
  browserInstallArgs,
  browserInstallCommand,
  browserInstallEnv,
  detectSystemEdgeBinary,
  edgeInstallNeedsInteractivePrivilegedSession,
  isEdgePrivilegeEscalationFailure,
  runCommand
} from './lib/runner'
import {
  removeBrowserDir,
  resolveBrowserInstallDir,
  resolveBrowsersCacheRoot
} from './lib/cache-root'

export interface InstallOptions {
  browser: string
}

export interface UninstallOptions {
  browser?: string
  all?: boolean
}

export function getManagedBrowsersCacheRoot(): string {
  return resolveBrowsersCacheRoot()
}

export function getManagedBrowserInstallDir(browser: string): string {
  const target = normalizeBrowserName(browser)
  return resolveBrowserInstallDir(target)
}

export async function extensionInstall({
  browser
}: InstallOptions): Promise<void> {
  const target = normalizeBrowserName(browser)
  const destination = resolveBrowserInstallDir(target)

  if (target === 'edge' && edgeInstallNeedsInteractivePrivilegedSession()) {
    throw new Error(messages.edgeInstallNeedsInteractivePrivilegedSession())
  }

  console.log(messages.installingBrowser(target, destination))

  const cmd = browserInstallCommand(target)
  const args = browserInstallArgs(target, destination)
  const env = browserInstallEnv(target, destination)
  const result = await runCommand(cmd, args, {cwd: process.cwd(), env})

  if (result.code !== 0) {
    if (target === 'edge' && isEdgePrivilegeEscalationFailure(result.stderr)) {
      const systemEdge = detectSystemEdgeBinary()

      if (systemEdge) {
        console.log(messages.edgeInstallUsingSystemBinary(systemEdge))
        return
      }

      throw new Error(messages.edgeInstallNeedsInteractivePrivilegedSession())
    }

    throw new Error(
      messages.installFailed(target, cmd, args, result.code, result.stderr)
    )
  }

  console.log(messages.installSucceeded(target, destination))
}

export async function extensionUninstall({
  browser,
  all
}: UninstallOptions): Promise<void> {
  const cacheRoot = resolveBrowsersCacheRoot()

  if (!all && !browser) {
    throw new Error(messages.uninstallRequiresTarget())
  }

  const targets: InstallBrowserTarget[] = all
    ? ['chrome', 'chromium', 'edge', 'firefox']
    : [normalizeBrowserName(String(browser || ''))]

  console.log(messages.uninstallingBrowsers(cacheRoot, targets))

  for (const target of targets) {
    const result = removeBrowserDir(target)

    if (result.removed) {
      console.log(messages.uninstallSucceeded(target, result.path))
    } else {
      console.log(messages.uninstallNoop(target, result.path))
    }
  }
}
