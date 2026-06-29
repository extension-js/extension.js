// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

export function parseFlatpakBinary(binary: string): {appId: string} | null {
  if (!binary || !binary.startsWith('flatpak:')) return null
  const appId = binary.substring(8).trim()
  return appId ? {appId} : null
}

/**
 * Whether the launched Firefox should run headless. Honors the standard
 * `MOZ_HEADLESS` env var (set by CI, Playwright, and our reload gates) so a
 * displayless host gets the headless widget backend rather than crashing the
 * SWGL compositor. Headed (interactive) `extension dev` is unaffected.
 */
export function isFirefoxHeadlessRequested(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return /^(1|true)$/i.test(String(env.MOZ_HEADLESS || '').trim())
}

export class FirefoxBinaryDetector {
  static generateFirefoxArgs(
    binaryPath: string,
    profilePath: string,
    debugPort: number,
    additionalArgs: string[] = [],
    headless = false
  ): {binary: string; args: string[]} {
    // The explicit `-headless` flag selects Firefox's headless widget backend
    // up front. Relying on MOZ_HEADLESS env alone lets the normal window/SWGL
    // compositor initialize first, which on a displayless host crashes with
    // "RenderCompositorSWGL failed mapping default framebuffer" before the RDP
    // server is ready. The flag avoids that, so headless CI/sandboxes can drive
    // the launched browser.
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
        '--foreground',
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
      '--foreground',
      ...additionalArgs
    ]

    return {binary: binaryPath, args}
  }
}
