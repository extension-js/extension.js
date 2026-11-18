//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {sources} from '@rspack/core'

// A stylesheet PostCSS rejects still loads in a browser, which error-recovers
// invalid CSS. For the native css module type the raw text cannot go to the
// parser, so the guard hands the parser one placeholder rule a minifier keeps
// and registers the raw sheet here; after the minimizer has run, any emitted
// .css asset that is that placeholder becomes the sheet as authored.
//
// The loader and the plugin live in separate dist bundles, so the registry
// hangs off globalThis to be one map in one process.

const REGISTRY_KEY = '__extensionjs_verbatim_css_registry__'

interface VerbatimEntry {
  raw: string
  resourcePath?: string
}

function registry(): Map<string, VerbatimEntry> {
  const holder = globalThis as unknown as Record<
    string,
    Map<string, VerbatimEntry>
  >
  if (!holder[REGISTRY_KEY]) holder[REGISTRY_KEY] = new Map()

  return holder[REGISTRY_KEY]
}

export const VERBATIM_CSS_MARKER = /__extjs_verbatim_([a-z0-9]+)__/

export function registerVerbatimCss(
  raw: string,
  resourcePath?: string
): string {
  const id = Math.abs(hash(`${resourcePath || ''}\n${raw}`)).toString(36)
  registry().set(id, {raw, resourcePath})

  return id
}

export function verbatimCssPlaceholder(id: string): string {
  return `.__extjs_verbatim_${id}__{--extjs-verbatim:1}\n`
}

// A css module renames local classes, so the marker stays global and each
// class the raw sheet names is exported as itself, matching the shipped text.
export function verbatimCssModulePlaceholder(id: string, raw: string): string {
  const scrubbed = raw.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const names = new Set<string>()

  for (const match of scrubbed.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    names.add(match[1])
  }

  const exported = [...names].map((name) => `${name}:${name}`).join(';')

  return (
    `:global(.__extjs_verbatim_${id}__){--extjs-verbatim:1}\n` +
    (exported ? `:export{${exported}}\n` : '')
  )
}

// The relative files a sheet names: @import targets and url() assets. A
// verbatim sheet skipped the parser, so nothing else ships them.
export function cssRelativeRefs(text: string): string[] {
  const scrubbed = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const refs = new Set<string>()

  const add = (value: string | undefined) => {
    const ref = String(value || '').trim()
    if (!ref || /^(?:[a-z]+:|\/\/|#|data:)/i.test(ref)) return
    if (ref.startsWith('/')) return

    refs.add(ref.split(/[?#]/)[0])
  }

  for (const match of scrubbed.matchAll(
    /@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\)?/gi
  )) {
    add(match[1])
  }

  for (const match of scrubbed.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    add(match[1])
  }

  return [...refs]
}

function hash(text: string): number {
  let value = 0

  for (let i = 0; i < text.length; i++) {
    value = (value * 31 + text.charCodeAt(i)) | 0
  }

  return value
}

// The registry ids the emitted sheets still name. A sheet left uncompiled
// in a watch rebuild keeps its placeholder, so its id is still in use.
export function verbatimCssIdsIn(
  compilation: Pick<Compilation, 'getAssets'>
): Set<string> {
  const ids = new Set<string>()

  for (const asset of compilation.getAssets()) {
    if (!asset.name.endsWith('.css')) continue

    const match = VERBATIM_CSS_MARKER.exec(asset.source.source().toString())
    if (match) ids.add(match[1])
  }

  return ids
}

export function forgetVerbatimCss(ids: Iterable<string>): void {
  for (const id of ids) registry().delete(id)
}

// Runs after the minimizer: the placeholder rule survived it, the raw sheet
// never met it, so production ships every rule development ships.
export function restoreVerbatimCssAssets(
  compilation: Pick<Compilation, 'getAssets' | 'updateAsset'> &
    Partial<Pick<Compilation, 'emitAsset' | 'getAsset'>>
): string[] {
  const restored: string[] = []

  for (const asset of compilation.getAssets()) {
    if (!asset.name.endsWith('.css')) continue

    const text = asset.source.source().toString()
    const match = VERBATIM_CSS_MARKER.exec(text)
    if (!match) continue

    const entry = registry().get(match[1])
    if (!entry) continue

    compilation.updateAsset(asset.name, new sources.RawSource(entry.raw))
    restored.push(asset.name)

    if (entry.resourcePath) {
      emitVerbatimCssClosure(
        compilation,
        asset.name,
        entry.raw,
        entry.resourcePath,
        new Set()
      )
    }
  }

  return restored
}

// Ship what a verbatim sheet references, at the paths the shipped sheet
// names (relative to its emitted location), imports of imports included.
function emitVerbatimCssClosure(
  compilation: Partial<Pick<Compilation, 'emitAsset' | 'getAsset'>>,
  assetName: string,
  text: string,
  resourcePath: string,
  seen: Set<string>
): void {
  if (typeof compilation.emitAsset !== 'function') return

  const sourceDir = path.dirname(resourcePath)
  const assetDir = path.posix.dirname(assetName)

  for (const ref of cssRelativeRefs(text)) {
    const sourceFile = path.resolve(sourceDir, ref)
    if (seen.has(sourceFile) || !fs.existsSync(sourceFile)) continue

    seen.add(sourceFile)
    const outName = path.posix.normalize(
      path.posix.join(assetDir, ref.split(path.sep).join('/'))
    )
    if (outName.startsWith('..')) continue

    const bytes = fs.readFileSync(sourceFile)

    if (
      typeof compilation.getAsset !== 'function' ||
      !compilation.getAsset(outName)
    ) {
      compilation.emitAsset(outName, new sources.RawSource(bytes))
    }

    if (sourceFile.endsWith('.css')) {
      emitVerbatimCssClosure(
        compilation,
        outName,
        bytes.toString('utf8'),
        sourceFile,
        seen
      )
    }
  }
}

// The class and id tokens a sheet selects on. A minimizer merges and
// reorders rules but never drops a selector the browser would keep, so a
// token present before and absent after is a rule the minimizer lost.
export function cssSelectorTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  // Comments, string literals and url() payloads carry no selectors; an
  // unclosed at-rule can hide a rule inside its prelude, so the scan reads
  // the whole remaining text rather than block by block.
  const scrubbed = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/url\([^)]*\)/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')

  for (const match of scrubbed.matchAll(/[.#][A-Za-z_-][\w-]*/g)) {
    const token = match[0]
    // A hex colour is a value, not a selector.
    if (/^#[0-9a-fA-F]{3,8}$/.test(token)) continue

    tokens.add(token)
  }

  return tokens
}

// A rule with no declarations styles nothing, so a minimizer that deletes
// it lost nothing. An at-rule left holding only such rules goes the same way.
export function withoutEmptyCssRules(text: string): string {
  let current = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/url\([^)]*\)/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')

  for (;;) {
    const next = current.replace(/[^{};]*\{[\s;]*\}/g, ' ')
    if (next === current) return current

    current = next
  }
}

export function minifierDroppedTokens(before: string, after: string): string[] {
  const kept = cssSelectorTokens(after)

  return [...cssSelectorTokens(withoutEmptyCssRules(before))].filter(
    (token) => !kept.has(token)
  )
}
