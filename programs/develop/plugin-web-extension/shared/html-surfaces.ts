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

  if (
    isChromiumBasedBrowser(String(browser || '')) &&
    manifest.browser_action != null
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
