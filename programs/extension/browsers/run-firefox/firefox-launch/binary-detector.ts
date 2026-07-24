// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isHeadlessGuardRequested} from '../../browsers-lib/shared-utils'

export function parseFlatpakBinary(binary: string): {appId: string} | null {
  if (!binary || !binary.startsWith('flatpak:')) return null
  const appId = binary.substring(8).trim()
  return appId ? {appId} : null
}

// Honors MOZ_HEADLESS (CI, Playwright, reload gates) so a displayless host
// gets the headless widget backend, plus the EXTENSION_HEADLESS guard.
export function isFirefoxHeadlessRequested(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    /^(1|true)$/i.test(String(env.MOZ_HEADLESS || '').trim()) ||
    isHeadlessGuardRequested(env)
  )
}

export class FirefoxBinaryDetector {
  static generateFirefoxArgs(
    binaryPath: string,
    profilePath: string,
    debugPort: number,
    additionalArgs: string[] = [],
    headless = false
  ): {binary: string; args: string[]} {
    // The explicit -headless flag selects the headless backend up front; env alone
    // lets the SWGL compositor initialize first and crash on displayless hosts.
    const headlessArgs = headless ? ['-headless'] : []

    // Flatpak: rewrite to `flatpak run` with sandbox filesystem access
    const flatpak = parseFlatpakBinary(binaryPath)
    if (flatpak) {
      const args: string[] = [
        'run',
        `--filesystem=${profilePath}`,
        flatpak.appId,
        '--no-remote',
        '--new-instance',
        ...headlessArgs,
        '-profile',
        profilePath,
        ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
        // --foreground raises the window on launch; pointless (and a focus
        // steal on macOS) when there is no window.
        ...(headless ? [] : ['--foreground']),
        ...additionalArgs
      ]
      return {binary: 'flatpak', args}
    }

    const args: string[] = [
      '--no-remote',
      '--new-instance',
      ...headlessArgs,
      ...(process.platform === 'win32' ? ['-wait-for-browser'] : []),
      '-profile',
      profilePath,
      ...(debugPort > 0 ? ['-start-debugger-server', String(debugPort)] : []),
      ...(headless ? [] : ['--foreground']),
      ...additionalArgs
    ]

    return {binary: binaryPath, args}
  }
}
