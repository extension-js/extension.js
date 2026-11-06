// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export interface WebkitUnsupportedKey {
  key: string
  reason: string
}

// Top-level keys the converter rejects and MDN confirms Safari does not
// implement, plus `incognito`, which Safari parses but always overrides.
export const WEBKIT_UNSUPPORTED_TOP_LEVEL_KEYS: Readonly<
  Record<string, string>
> = Object.freeze({
  side_panel: 'Safari has no side panel surface',
  sidebar_action: 'Safari has no sidebar surface',
  sandbox: 'Safari cannot run sandboxed extension pages',
  user_scripts: 'Safari has no userScripts API',
  omnibox: 'Safari has no omnibox keyword API',
  chrome_settings_overrides: 'Safari lets no extension override these settings',
  tts_engine: 'Safari has no speech engine API',
  file_browser_handlers: 'ChromeOS only',
  input_components: 'ChromeOS only',
  cross_origin_embedder_policy: 'Safari reads no COEP key from a manifest',
  cross_origin_opener_policy: 'Safari reads no COOP key from a manifest',
  requirements: 'Chrome Web Store only',
  oauth2: 'Safari has no identity API to consume it',
  nacl_modules: 'Native Client is Chrome only',
  replacement_web_app: 'Chrome Web Store only',
  offline_enabled: 'Chrome Web Store only',
  differential_fingerprint: 'Chrome Web Store only',
  incognito:
    'Safari always runs extensions in spanning mode and ignores the declared value'
})

// Permission strings the converter rejects. Every one of them also reads as
// unsupported or absent in MDN browser-compat-data, so none is a false drop.
export const WEBKIT_UNSUPPORTED_PERMISSIONS: ReadonlySet<string> =
  new Set<string>([
    'accessibilityFeatures.modify',
    'accessibilityFeatures.read',
    'audio',
    'background',
    'bookmarks',
    'browsingData',
    'certificateProvider',
    'clipboardRead',
    'contentSettings',
    'debugger',
    'declarativeContent',
    'desktopCapture',
    'documentScan',
    'downloads',
    'enterprise.deviceAttributes',
    'enterprise.platformKeys',
    'experimental',
    'favicon',
    'fileSystemProvider',
    'fontSettings',
    'gcm',
    'geolocation',
    'history',
    'identity',
    'identity.email',
    'idle',
    'management',
    'notifications',
    'offscreen',
    'pageCapture',
    'platformKeys',
    'power',
    'printerProvider',
    'privacy',
    'processes',
    'proxy',
    'readingList',
    'search',
    'sessions',
    'sidePanel',
    'system.cpu',
    'system.display',
    'system.memory',
    'system.storage',
    'systemLog',
    'tabCapture',
    'tabGroups',
    'topSites',
    'tts',
    'ttsEngine',
    'userScripts',
    'vpnProvider',
    'wallpaper',
    'webAuthenticationProxy',
    'webRequestBlocking'
  ])

// Nested properties that are inert on Safari. `open_in_tab` is accepted but
// ignored, since Safari always opens an options page in its own tab.
export const WEBKIT_UNSUPPORTED_OPTIONS_UI_KEYS: Readonly<
  Record<string, string>
> = Object.freeze({
  open_in_tab: 'Safari always opens the options page in a tab'
})

export function webkitUnsupportedManifestKeys(): WebkitUnsupportedKey[] {
  return [
    ...Object.entries(WEBKIT_UNSUPPORTED_TOP_LEVEL_KEYS).map(
      ([key, reason]) => ({key, reason})
    ),
    ...Object.entries(WEBKIT_UNSUPPORTED_OPTIONS_UI_KEYS).map(
      ([key, reason]) => ({key: `options_ui.${key}`, reason})
    )
  ]
}

export function webkitUnsupportedPermissions(): string[] {
  return [...WEBKIT_UNSUPPORTED_PERMISSIONS]
}

export interface WebkitDroppedPage {
  // Root-relative output path of the page, the way a getURL literal names it
  path: string
  // Dotted manifest location that named the page, like side_panel.default_path
  key: string
  reason: string
}

function pagePath(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const clean = trimmed.split(/[?#]/)[0]

  return /\.html?$/i.test(clean) ? clean : null
}

// The pages a dropped key named. The build emits none of them, and the
// reference that still opens one at runtime is what the tracer warns about.
export function webkitDroppedSurfacePages(
  manifest: Record<string, unknown> | undefined
): WebkitDroppedPage[] {
  if (!manifest) return []

  const pages: WebkitDroppedPage[] = []

  const add = (key: string, owner: string, value: unknown) => {
    const found = pagePath(value)
    if (!found) return

    pages.push({
      path: found,
      key,
      reason: WEBKIT_UNSUPPORTED_TOP_LEVEL_KEYS[owner]
    })
  }

  const sidePanel = manifest.side_panel as {default_path?: unknown} | undefined
  add('side_panel.default_path', 'side_panel', sidePanel?.default_path)

  const sidebar = manifest.sidebar_action as
    | {default_panel?: unknown}
    | undefined
  add('sidebar_action.default_panel', 'sidebar_action', sidebar?.default_panel)

  const sandbox = manifest.sandbox as {pages?: unknown} | undefined

  if (Array.isArray(sandbox?.pages)) {
    for (const [index, page] of sandbox.pages.entries()) {
      add(`sandbox.pages.${String(index)}`, 'sandbox', page)
    }
  }

  return pages
}
