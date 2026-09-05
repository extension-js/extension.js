// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from '../../lib/constants'
import type {DevOptions, Manifest} from '../../types'

// The manifest-fields package folds action, browser_action and page_action
// into one action/index slot, first wins. Firefox drives the toolbar and the
// address bar as independent surfaces, so a page_action popup of its own
// gets its own page; only a shared source keeps sharing one page.

export const ACTION_HTML_FEATURE = 'action/index'
export const PAGE_ACTION_HTML_FEATURE = 'page_action/index'
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

export function resolveManifestHtmlPath(
  context: string,
  relativePath: string
): string {
  const unix = relativePath.replace(/\\/g, '/')
  if (/^\/public\//i.test(unix)) {
    return path.join(context, 'public', unix.replace(/^\/public\//i, ''))
  }
  if (/^(?:\.\/)?public\//i.test(unix)) {
    return path.join(context, 'public', unix.replace(/^(?:\.\/)?public\//i, ''))
  }
  if (/^\//.test(unix)) return path.join(context, unix.slice(1))
  return path.join(context, unix)
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
  browser: DevOptions['browser'] | string | undefined
): HtmlFields {
  const next: HtmlFields = {...(html || {})}
  const actionRef = actionPopupRef(manifest)
  const pageRef = pageActionPopupRef(manifest)
  const actionAbs = actionRef
    ? resolveManifestHtmlPath(context, actionRef)
    : undefined
  const pageAbs = pageRef
    ? resolveManifestHtmlPath(context, pageRef)
    : undefined

  // Rebuild the collapsed slot from the toolbar key alone.
  if (actionAbs) next[ACTION_HTML_FEATURE] = actionAbs
  else delete next[ACTION_HTML_FEATURE]

  if (!pageAbs || pageActionDropReason(manifest, browser)) {
    delete next[PAGE_ACTION_HTML_FEATURE]
    return next
  }
  if (actionAbs && popupRefsShareSource(actionRef, pageRef)) {
    delete next[PAGE_ACTION_HTML_FEATURE]
    return next
  }
  next[PAGE_ACTION_HTML_FEATURE] = pageAbs
  return next
}
