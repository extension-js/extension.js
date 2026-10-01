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
// into one action/index slot, first wins. Firefox drives the toolbar and the
// address bar as independent surfaces, so a page_action popup of its own
// gets its own page; only a shared source keeps sharing one page.

export const ACTION_HTML_FEATURE = 'action/index'
export const PAGE_ACTION_HTML_FEATURE = 'page_action/index'
export const OPTIONS_HTML_FEATURE = 'options/index'
export const ACTION_HTML_OUTPUT = 'action/index.html'
export const PAGE_ACTION_HTML_OUTPUT = 'page_action/index.html'

type HtmlFields = Record<string, string | undefined>

function readDefaultPopup(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const popup = (value as {default_popup?: unknown}).default_popup
  if (typeof popup !== 'string') return undefined

  const trimmed = popup.trim()

  return trimmed || undefined
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

export function pageActionPopupRef(
  manifest: Manifest | undefined
): string | undefined {
  if (!manifest) return undefined

  return readDefaultPopup(manifest.page_action)
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
  const pageRef = pageActionPopupRef(manifest)

  if (actionRef && pageRef && popupRefsShareSource(actionRef, pageRef)) {
    return ACTION_HTML_OUTPUT
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

  const actionRef = actionPopupRef(manifest)
  const pageRef = pageActionPopupRef(manifest)
  const actionAbs = actionRef
    ? resolveManifestHtmlPath(context, actionRef, projectPath)
    : undefined
  const pageAbs = pageRef
    ? resolveManifestHtmlPath(context, pageRef, projectPath)
    : undefined

  // Rebuild the collapsed slot from the toolbar key alone.
  if (actionAbs) next[ACTION_HTML_FEATURE] = actionAbs
  else delete next[ACTION_HTML_FEATURE]

  if (!pageAbs || pageActionDropReason(manifest, browser)) {
    delete next[PAGE_ACTION_HTML_FEATURE]

    return leavePublicPagesToCopier(next, context, projectPath)
  }

  if (actionAbs && popupRefsShareSource(actionRef, pageRef)) {
    delete next[PAGE_ACTION_HTML_FEATURE]

    return leavePublicPagesToCopier(next, context, projectPath)
  }

  next[PAGE_ACTION_HTML_FEATURE] = pageAbs

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
