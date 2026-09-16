// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export interface LegacyManifestPathRule {
  field: string
  legacyPath: string
  modernPath: string
}

export interface LegacyManifestPathHit {
  field: string
  legacyPath: string
  modernPath: string
}

export const LEGACY_MANIFEST_PATH_RULES: readonly LegacyManifestPathRule[] = [
  {
    field: 'devtools_page',
    legacyPath: 'devtools_page/devtools_page.html',
    modernPath: 'devtools/index.html'
  },
  {
    field: 'options_ui.page',
    legacyPath: 'options_ui/page.html',
    modernPath: 'options/index.html'
  },
  {
    field: 'background.page',
    legacyPath: 'background/page.html',
    modernPath: 'background/index.html'
  },
  {
    field: 'browser_action.default_popup',
    legacyPath: 'browser_action/default_popup.html',
    modernPath: 'action/index.html'
  },
  {
    field: 'page_action.default_popup',
    legacyPath: 'page_action/default_popup.html',
    modernPath: 'action/index.html'
  },
  {
    field: 'side_panel.default_path',
    legacyPath: 'side_panel/default_path.html',
    modernPath: 'sidebar/index.html'
  },
  {
    field: 'sidebar_action.default_panel',
    legacyPath: 'sidebar_action/default_panel.html',
    modernPath: 'sidebar/index.html'
  }
] as const

export function normalizeLegacyPathRef(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
}

function readField(manifest: unknown, field: string): unknown {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return undefined
  }

  let current: unknown = manifest

  for (const part of field.split('.')) {
    if (
      !current ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !(part in (current as Record<string, unknown>))
    ) {
      return undefined
    }

    current = (current as Record<string, unknown>)[part]
  }

  return current
}

export function findLegacyManifestPathHits(
  manifest: unknown
): LegacyManifestPathHit[] {
  const hits: LegacyManifestPathHit[] = []

  for (const rule of LEGACY_MANIFEST_PATH_RULES) {
    const value = readField(manifest, rule.field)
    if (typeof value !== 'string' || !value.trim()) continue
    if (normalizeLegacyPathRef(value) !== rule.legacyPath) continue

    hits.push({
      field: rule.field,
      legacyPath: rule.legacyPath,
      modernPath: rule.modernPath
    })
  }

  return hits
}
