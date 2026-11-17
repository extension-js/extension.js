// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Manifest} from '../../types'
import {OPTIONS_HTML_FEATURE} from './html-surfaces'

// A page the build compiles into its canonical folder while a script of the
// extension still holds the path the author wrote, so that path stays live.
export interface KeptPagePath {
  // Both are relative to the extension root.
  output: string
  authored: string
  // The emitted script that holds the authored path as a string.
  mentionedIn: string
}

// Keyed by the compilation object, which every step of one build shares.
const keptByCompilation = new WeakMap<object, Map<string, KeptPagePath>>()

export function keepPagePath(compilation: object, kept: KeptPagePath): void {
  const pages = keptByCompilation.get(compilation) ?? new Map()

  if (!pages.has(kept.output)) pages.set(kept.output, kept)

  keptByCompilation.set(compilation, pages)
}

export function keptPagePaths(
  compilation: object
): ReadonlyMap<string, KeptPagePath> {
  return keptByCompilation.get(compilation) ?? new Map()
}

function normalizePagePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split(/[?#]/)[0]
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '')
}

// What may stand before the page path in a string that still names the page:
// nothing, steps like ./ and ../, or the origin of an extension URL.
const NAVIGATION_PREFIX = /^(?:\.{0,2}\/)*$/
const ORIGIN_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/]*\/$/i

// A string names a page when it is the authored path, however it is reached.
// A longer path that merely ends the same way is another file.
export function namesPagePath(literal: string, authored: string): boolean {
  const page = normalizePagePath(authored)
  const text = literal.trim().replace(/\\/g, '/').split(/[?#]/)[0]

  if (!page || !text.endsWith(page)) return false

  const before = text.slice(0, text.length - page.length)

  return NAVIGATION_PREFIX.test(before) || ORIGIN_PREFIX.test(before)
}

// The compiled page an authored path serves when several manifest keys share
// one source. The options page wins: only it carries what the dialog needs.
export function pageServedAtAuthoredPath(outputs: string[]): string {
  const options = `${OPTIONS_HTML_FEATURE}.html`

  return outputs.includes(options) ? options : outputs[0]
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Points every page key of the built manifest that names a kept page back
// at the path the author wrote. Keys that name other pages stay as built.
export function applyKeptPagePaths(
  manifest: Manifest,
  kept: ReadonlyMap<string, KeptPagePath>
): {manifest: Manifest; applied: Array<KeptPagePath & {field: string}>} {
  const applied: Array<KeptPagePath & {field: string}> = []
  if (kept.size === 0) return {manifest, applied}

  const authoredFor = (value: unknown, field: string): string | undefined => {
    if (typeof value !== 'string') return undefined

    const page = kept.get(normalizePagePath(value))
    if (!page) return undefined

    applied.push({...page, field})

    return page.authored
  }

  const next: Fields = {...(manifest as Fields)}

  const repoint = (key: string, property: string) => {
    const owner = next[key]
    if (!isFields(owner)) return

    const authored = authoredFor(owner[property], `${key}.${property}`)
    if (authored) next[key] = {...owner, [property]: authored}
  }

  repoint('action', 'default_popup')
  repoint('browser_action', 'default_popup')
  repoint('page_action', 'default_popup')
  repoint('options_ui', 'page')
  repoint('side_panel', 'default_path')
  repoint('sidebar_action', 'default_panel')

  for (const key of ['options_page', 'devtools_page']) {
    const authored = authoredFor(next[key], key)
    if (authored) next[key] = authored
  }

  const overrides = next.chrome_url_overrides

  if (isFields(overrides)) {
    for (const key of Object.keys(overrides)) {
      repoint('chrome_url_overrides', key)
    }
  }

  const sandbox = next.sandbox

  if (isFields(sandbox) && Array.isArray(sandbox.pages)) {
    next.sandbox = {
      ...sandbox,
      pages: sandbox.pages.map(
        (page, index) => authoredFor(page, `sandbox.pages[${index}]`) ?? page
      )
    }
  }

  return {manifest: next as Manifest, applied}
}
