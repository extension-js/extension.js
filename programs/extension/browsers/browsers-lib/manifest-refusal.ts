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

/**
 * Match patterns Chrome's grammar refuses — a query string / fragment
 * (`?`, `#`) or an explicit port in the host. ONE invalid pattern in
 * content_scripts matches, host_permissions, or web_accessible_resources
 * makes Chrome refuse the WHOLE extension at load (wild: Ban-Checker's
 * `.../gcpd/730?tab=majors`, Better-Names' `host:8888/...`). Loading the
 * source unpacked fails identically, so this is extension-own — but dev
 * must say so instead of printing an ID for an extension that never loads.
 */
export function findInvalidMatchPatterns(manifest: unknown): string[] {
  const m = manifest as Record<string, any> | null | undefined
  const patterns: string[] = []

  for (const list of [m?.host_permissions, m?.optional_host_permissions]) {
    if (Array.isArray(list)) patterns.push(...list)
  }
  for (const contentScript of Array.isArray(m?.content_scripts)
    ? m.content_scripts
    : []) {
    for (const list of [
      contentScript?.matches,
      contentScript?.exclude_matches
    ]) {
      if (Array.isArray(list)) patterns.push(...list)
    }
  }
  for (const resource of Array.isArray(m?.web_accessible_resources)
    ? m.web_accessible_resources
    : []) {
    if (Array.isArray(resource?.matches)) patterns.push(...resource.matches)
  }

  const invalid = patterns.filter(
    (pattern): pattern is string =>
      typeof pattern === 'string' &&
      pattern !== '<all_urls>' &&
      (pattern.includes('?') ||
        pattern.includes('#') ||
        /^[a-zA-Z*]+:\/\/[^/]*:\d+(?:\/|$)/.test(pattern))
  )

  return [...new Set(invalid)]
}
