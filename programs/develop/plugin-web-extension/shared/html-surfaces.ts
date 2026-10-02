// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from '../../lib/constants'
import {
  findPublicFile,
  inspectPublicFolders,
  publicRelativePath
} from '../../plugin-special-folders/resolve-public-folder'
import type {DevOptions, Manifest} from '../../types'

// The manifest-fields package folds action, browser_action and page_action
// into one action/index slot and side_panel with sidebar_action into one
// sidebar/index slot, first wins. A cross-browser manifest names one page
// per key, so a second key that names its own source gets its own page;
// only a shared source keeps sharing one page.

export const ACTION_HTML_FEATURE = 'action/index'
export const BROWSER_ACTION_HTML_FEATURE = 'browser_action/index'
export const PAGE_ACTION_HTML_FEATURE = 'page_action/index'
export const OPTIONS_HTML_FEATURE = 'options/index'
export const SIDEBAR_HTML_FEATURE = 'sidebar/index'
export const SIDEBAR_ACTION_HTML_FEATURE = 'sidebar_action/index'
export const ACTION_HTML_OUTPUT = 'action/index.html'
export const BROWSER_ACTION_HTML_OUTPUT = 'browser_action/index.html'
export const PAGE_ACTION_HTML_OUTPUT = 'page_action/index.html'
export const SIDEBAR_HTML_OUTPUT = 'sidebar/index.html'
export const SIDEBAR_ACTION_HTML_OUTPUT = 'sidebar_action/index.html'

type HtmlFields = Record<string, string | undefined>

function readPageRef(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const page = (value as Record<string, unknown>)[key]
  if (typeof page !== 'string') return undefined

  const trimmed = page.trim()

  return trimmed || undefined
}

function readDefaultPopup(value: unknown): string | undefined {
  return readPageRef(value, 'default_popup')
}

export function normalizePopupRef(ref: string): string {
  return String(ref || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

export function popupRefsShareSource(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  const left = normalizePopupRef(a)
  const right = normalizePopupRef(b)

  return Boolean(left) && left === right
}

// A page the manifest names resolves beside the manifest first; a page that
// only public/ has (project root first, then next to the manifest) resolves
// there, since the copier ships it verbatim under the name the manifest keeps.
export function resolveManifestHtmlPath(
  context: string,
  relativePath: string,
  projectPath?: string
): string {
  const unix = relativePath.replace(/\\/g, '/')
  const manifestPath = path.join(context, 'manifest.json')
  const hosted = findPublicFile(manifestPath, projectPath, unix)

  if (/^(?:\/public\/|(?:\.\/)?public\/)/i.test(unix)) {
    return hosted || path.join(context, 'public', publicRelativePath(unix))
  }

  const beside = /^\//.test(unix)
    ? path.join(context, unix.slice(1))
    : path.join(context, unix)

  if (hosted && !fs.existsSync(beside)) return hosted

  return beside
}

export function actionPopupRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  return (
    readDefaultPopup(manifest.action) ||
    readDefaultPopup(manifest.browser_action)
  )
}

// The browser_action popup that needs a page of its own: one that sits
// beside an action popup built from a different source.
export function browserActionOwnPopupRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  const action = readDefaultPopup(manifest.action)
  const browserAction = readDefaultPopup(manifest.browser_action)

  if (!action || !browserAction) return undefined
  if (popupRefsShareSource(action, browserAction)) return undefined

  return browserAction
}

export function browserActionOutputTarget(manifest: Manifest): string {
  return browserActionOwnPopupRef(manifest)
    ? BROWSER_ACTION_HTML_OUTPUT
    : ACTION_HTML_OUTPUT
}

export function pageActionPopupRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  return readDefaultPopup(manifest.page_action)
}

export function sidebarPanelRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  return (
    readPageRef(manifest.side_panel, 'default_path') ||
    readPageRef(manifest.sidebar_action, 'default_panel')
  )
}

// The sidebar_action panel that needs a page of its own: one that sits
// beside a side_panel built from a different source.
export function sidebarActionOwnPanelRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  const sidePanel = readPageRef(manifest.side_panel, 'default_path')
  const sidebarAction = readPageRef(manifest.sidebar_action, 'default_panel')

  if (!sidePanel || !sidebarAction) return undefined
  if (popupRefsShareSource(sidePanel, sidebarAction)) return undefined

  return sidebarAction
}

export function sidebarActionOutputTarget(manifest: Manifest): string {
  return sidebarActionOwnPanelRef(manifest)
    ? SIDEBAR_ACTION_HTML_OUTPUT
    : SIDEBAR_HTML_OUTPUT
}

// The source the single options page is built from. Chromium reads the legacy
// options_page only when options_ui.page gave no URL, and Gecko reads
// options_ui.page first too, so the modern key owns the compiled page.
export function optionsPageRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  const modern = (manifest.options_ui as {page?: unknown} | undefined)?.page
  if (typeof modern === 'string' && modern.trim()) return modern.trim()

  const legacy = (manifest as {options_page?: unknown}).options_page
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim()

  return undefined
}

// Firefox shows page_action in every manifest version; Chromium dropped the
// surface with Manifest V3.
export function isPageActionLiveSurface(
  manifest: Manifest | undefined,
  browser: DevOptions['browser'] | string | undefined
): boolean {
  if (isGeckoBasedBrowser(String(browser || ''))) return true

  const version = Number(
    (manifest as {manifest_version?: unknown} | undefined)?.manifest_version
  )

  return Number.isFinite(version) && version < 3
}

// Why the built manifest leaves page_action out: the surface never shows
// on this browser, or Chrome refuses a Manifest V2 manifest that declares
// browser_action next to it ("Only one of browser_action, page_action, and
// app can be specified"), so the toolbar key wins.
export type PageActionDropReason = 'unsupported' | 'conflicts'

export function pageActionDropReason(
  manifest: Manifest | undefined,
  browser: DevOptions['browser'] | string | undefined
): PageActionDropReason | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined

  if (!('page_action' in manifest) || manifest.page_action == null) {
    return undefined
  }

  if (!isPageActionLiveSurface(manifest, browser)) return 'unsupported'

  // A Manifest V2 action ships as browser_action, so it conflicts the same.
  if (
    isChromiumBasedBrowser(String(browser || '')) &&
    (manifest.browser_action != null ||
      shouldFoldActionIntoBrowserAction(manifest))
  ) {
    return 'conflicts'
  }

  return undefined
}

export function shouldDropPageAction(
  manifest: Manifest | undefined,
  browser: DevOptions['browser'] | string | undefined
): boolean {
  return pageActionDropReason(manifest, browser) !== undefined
}

export function dropPageAction(manifest: Manifest): Manifest {
  if (!manifest || !('page_action' in manifest)) return manifest

  const rest = {...manifest}
  delete rest.page_action

  return rest
}

// Every browser replaced browser_action with action in Manifest V3, so the
// key is a dead toolbar button there: the extension installs with no load
// error and the popup never opens.
export function isBrowserActionLiveSurface(
  manifest: Manifest | undefined
): boolean {
  const version = Number(
    (manifest as {manifest_version?: unknown} | undefined)?.manifest_version
  )

  return !Number.isFinite(version) || version < 3
}

// A Manifest V3 manifest that names browser_action and no action at all has
// no toolbar surface any browser reads, so the old key becomes the new one.
// A manifest that names both keeps both: each gets its own page above.
export function shouldFoldBrowserActionIntoAction(
  manifest: Manifest | undefined
): boolean {
  if (!manifest || typeof manifest !== 'object') return false

  if (!('browser_action' in manifest) || manifest.browser_action == null) {
    return false
  }

  if (isBrowserActionLiveSurface(manifest)) return false

  return manifest.action == null
}

export function foldBrowserActionIntoAction(manifest: Manifest): Manifest {
  if (!shouldFoldBrowserActionIntoAction(manifest)) return manifest

  const {browser_action: folded, ...rest} = manifest

  return {...rest, action: folded} as Manifest
}

// The mirror of the fold above. Manifest V2 has no action key on any browser,
// so an MV3 manifest built for a Manifest V2 target (the firefox: prefix
// recipe) ships a toolbar button nothing reads and no popup at all.
export function shouldFoldActionIntoBrowserAction(
  manifest: Manifest | undefined
): boolean {
  if (!manifest || typeof manifest !== 'object') return false

  if (!('action' in manifest) || manifest.action == null) return false

  const version = Number(
    (manifest as {manifest_version?: unknown}).manifest_version
  )

  if (version !== 2) return false

  return manifest.browser_action == null
}

export function foldActionIntoBrowserAction(manifest: Manifest): Manifest {
  if (!shouldFoldActionIntoBrowserAction(manifest)) return manifest

  const {action: folded, ...rest} = manifest

  return {
    ...rest,
    browser_action: folded,
    ...renameExecuteActionCommand(manifest)
  } as Manifest
}

// The reserved shortcut follows the key: Manifest V2 binds the toolbar button
// to _execute_browser_action and never reads _execute_action.
function renameExecuteActionCommand(manifest: Manifest): {
  commands?: Manifest['commands']
} {
  const commands = manifest.commands as Record<string, unknown> | undefined

  if (!commands || typeof commands !== 'object') return {}
  if (!('_execute_action' in commands)) return {}
  if ('_execute_browser_action' in commands) return {}

  const {_execute_action: shortcut, ...others} = commands

  return {
    commands: {...others, _execute_browser_action: shortcut}
  } as {commands?: Manifest['commands']}
}

// Chromium opens a panel only from side_panel and Gecko only from
// sidebar_action, so a manifest that names one key of the pair has no sidebar
// at all on the other family. A manifest that names both keeps both: each key
// already owns its own page above.
export type SidebarFoldTarget = 'side_panel' | 'sidebar_action'

export function sidebarFoldTarget(
  manifest: Manifest | undefined,
  browser: DevOptions['browser'] | string | undefined
): SidebarFoldTarget | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined

  // A key the manifest already declares for this build is never rewritten,
  // even one with no page in it.
  const hasSidePanel = manifest.side_panel != null
  const hasSidebarAction = manifest.sidebar_action != null

  if (hasSidePanel === hasSidebarAction) return undefined

  const target = String(browser || '')

  if (hasSidebarAction) {
    if (!readPageRef(manifest.sidebar_action, 'default_panel')) return undefined
    if (!isChromiumBasedBrowser(target)) return undefined
    // Opera reads sidebar_action itself, so the key it was given stays.
    if (target === 'opera') return undefined

    // side_panel exists from Manifest V3 on, Manifest V2 has nothing to read.
    const version = Number(
      (manifest as {manifest_version?: unknown}).manifest_version
    )

    return version >= 3 ? 'side_panel' : undefined
  }

  if (!readPageRef(manifest.side_panel, 'default_path')) return undefined

  return isGeckoBasedBrowser(target) ? 'sidebar_action' : undefined
}

// Chromium shows no panel for a side_panel key alone, the sidePanel
// permission has to be there too, and it is one Chromium never warns about.
export const SIDE_PANEL_PERMISSION = 'sidePanel'

function withSidePanelPermission(manifest: Manifest): string[] {
  const current = Array.isArray(manifest.permissions)
    ? (manifest.permissions as string[])
    : []

  return current.includes(SIDE_PANEL_PERMISSION)
    ? current
    : [...current, SIDE_PANEL_PERMISSION]
}

// Only the page reference carries over. Each key names a different set of
// extras and the vendor that reads the key ignores the other one's.
export function foldSidebarKeyForBrowser(
  manifest: Manifest,
  browser: DevOptions['browser'] | string | undefined
): Manifest {
  const target = sidebarFoldTarget(manifest, browser)

  if (!target) return manifest

  if (target === 'side_panel') {
    const panel = readPageRef(manifest.sidebar_action, 'default_panel')
    const {sidebar_action: _folded, ...rest} = manifest

    return {
      ...rest,
      side_panel: {default_path: panel},
      permissions: withSidePanelPermission(manifest)
    } as Manifest
  }

  const panel = readPageRef(manifest.side_panel, 'default_path')
  const {side_panel: _folded, ...rest} = manifest

  return {
    ...rest,
    sidebar_action: {default_panel: panel, ...sidebarActionStyle(manifest)}
  } as Manifest
}

// Firefox defaults browser_style to true on a Manifest V2 sidebar_action and
// injects its stylesheet into the panel, which Chromium never did to the
// side_panel page. Manifest V3 has no such key, and a value the user set stays.
function sidebarActionStyle(manifest: Manifest): {browser_style?: boolean} {
  const version = Number(
    (manifest as {manifest_version?: unknown}).manifest_version
  )

  if (version !== 2) return {}

  const source = manifest.side_panel as {browser_style?: unknown} | undefined
  const own = source?.browser_style

  return {browser_style: typeof own === 'boolean' ? own : false}
}

// The page the built page_action key must name: the shared toolbar page
// when both keys point at one source, its own page otherwise.
export function pageActionOutputTarget(manifest: Manifest): string {
  const actionRef = actionPopupRef(manifest)
  const browserActionRef = browserActionOwnPopupRef(manifest)
  const pageRef = pageActionPopupRef(manifest)

  if (actionRef && pageRef && popupRefsShareSource(actionRef, pageRef)) {
    return ACTION_HTML_OUTPUT
  }

  if (
    browserActionRef &&
    pageRef &&
    popupRefsShareSource(browserActionRef, pageRef)
  ) {
    return BROWSER_ACTION_HTML_OUTPUT
  }

  return PAGE_ACTION_HTML_OUTPUT
}

export function applyIndependentHtmlSurfaces(
  html: HtmlFields | undefined,
  manifest: Manifest,
  context: string,
  browser: DevOptions['browser'] | string | undefined,
  projectPath?: string
): HtmlFields {
  const next: HtmlFields = {...(html || {})}

  // The fields package folds both options keys into one slot and prefers the
  // legacy one, so repoint that slot at the key the browsers read first.
  const optionsRef = optionsPageRef(manifest)

  if (optionsRef) {
    next[OPTIONS_HTML_FEATURE] = resolveManifestHtmlPath(
      context,
      optionsRef,
      projectPath
    )
  }

  const resolve = (ref: string | undefined) =>
    ref ? resolveManifestHtmlPath(context, ref, projectPath) : undefined

  const assign = (feature: string, resolved: string | undefined) => {
    if (resolved) next[feature] = resolved
    else delete next[feature]
  }

  // Rebuild each collapsed slot from the key that owns it, then give the
  // second key of a pair its own slot when it names a source of its own.
  assign(SIDEBAR_HTML_FEATURE, resolve(sidebarPanelRef(manifest)))
  assign(
    SIDEBAR_ACTION_HTML_FEATURE,
    resolve(sidebarActionOwnPanelRef(manifest))
  )

  const actionRef = actionPopupRef(manifest)
  const pageRef = pageActionPopupRef(manifest)
  assign(ACTION_HTML_FEATURE, resolve(actionRef))
  assign(
    BROWSER_ACTION_HTML_FEATURE,
    resolve(browserActionOwnPopupRef(manifest))
  )

  const pageOwnsItsPage =
    pageRef &&
    !pageActionDropReason(manifest, browser) &&
    pageActionOutputTarget(manifest) === PAGE_ACTION_HTML_OUTPUT

  assign(
    PAGE_ACTION_HTML_FEATURE,
    pageOwnsItsPage ? resolve(pageRef) : undefined
  )

  return leavePublicPagesToCopier(next, context, projectPath)
}

// A page that lives in public/ ships verbatim under its own name through the
// copier, so the html pipeline must not compile a second copy into its slot.
function leavePublicPagesToCopier(
  html: HtmlFields,
  context: string,
  projectPath?: string
): HtmlFields {
  const manifestPath = path.join(context, 'manifest.json')
  const {fromRoot, fromManifest} = inspectPublicFolders(
    manifestPath,
    projectPath
  )
  const roots = [fromRoot, fromManifest].map((root) => path.resolve(root))

  for (const [feature, resolved] of Object.entries(html)) {
    if (typeof resolved !== 'string') continue

    const hosted = roots.some((root) => {
      const rel = path.relative(root, path.resolve(resolved))

      return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
    })

    if (hosted) delete html[feature]
  }

  return html
}
