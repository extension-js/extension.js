// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

/**
 * Manifest shapes Chromium refuses to load AT ALL — the refusal surfaces
 * only as a native dialog (or nothing), never as a console error, so the
 * dev session just wedges with no CDP target. Diagnose them before spawn
 * and say why, like the resolved-binary line.
 */
export type ChromiumManifestRefusal = 'mv2' | 'mv3-background-scripts' | null

export function diagnoseChromiumManifestRefusal(
  manifest: unknown
): ChromiumManifestRefusal {
  const m = manifest as Record<string, any> | null | undefined
  if (Number(m?.manifest_version) === 2) return 'mv2'

  // Firefox-style MV3: `background.scripts` with no `service_worker`.
  // Chromium requires background.service_worker in MV3 and refuses the
  // whole extension; Firefox is the browser this manifest is written for.
  if (
    Number(m?.manifest_version) === 3 &&
    Array.isArray(m?.background?.scripts) &&
    m.background.scripts.length > 0 &&
    !m?.background?.service_worker
  ) {
    return 'mv3-background-scripts'
  }

  return null
}
