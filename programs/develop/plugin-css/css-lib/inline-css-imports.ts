//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import postcss, {type AtRule, type Root} from 'postcss'
import {replaceCssUrlRefs, toPosixPath} from './dead-url-refs'

export interface InlineCssImportsContext {
  resourcePath: string
  // Where a root-absolute request can live: the public folder, then the
  // manifest folder, the order every other reference check uses.
  roots: string[]
}

export interface InlinedCssImports {
  css: string
  // Every sheet whose text is now part of this one.
  files: string[]
  // Every place a sheet that was not found could appear later.
  missing: string[]
  // A sheet that was found and could not be read as CSS.
  unreadable: Array<{request: string; file: string; reason: string}>
}

interface ParsedImport {
  request: string
  layer?: string
  supports?: string
  media?: string
}

const IMPORT_TARGET =
  /^(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)|"([^"]*)"|'([^']*)')\s*([\s\S]*)$/i

// Reads the text between a function's parentheses, nested ones included.
function takeFunction(
  text: string,
  name: string
): {inner: string; rest: string} | undefined {
  if (!new RegExp(`^${name}\\(`, 'i').test(text)) return undefined

  let depth = 0

  for (let at = name.length; at < text.length; at++) {
    if (text[at] === '(') depth++

    if (text[at] === ')' && --depth === 0) {
      return {
        inner: text.slice(name.length + 1, at),
        rest: text.slice(at + 1).trim()
      }
    }
  }

  return undefined
}

// Undefined for an import this step leaves to the browser or to a plugin:
// one it cannot read, or one that carries a function CSS does not define.
function parseImport(params: string): ParsedImport | undefined {
  const match = IMPORT_TARGET.exec(params.trim())
  if (!match) return undefined

  const request = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
  let rest = (match[6] || '').trim()
  const parsed: ParsedImport = {request}

  const layer = takeFunction(rest, 'layer')

  if (layer) {
    parsed.layer = layer.inner.trim()
    rest = layer.rest
  } else if (/^layer(?![\w-])/i.test(rest)) {
    parsed.layer = ''
    rest = rest.slice('layer'.length).trim()
  }

  const supports = takeFunction(rest, 'supports')

  if (supports) {
    parsed.supports = supports.inner.trim()
    rest = supports.rest
  }

  // What is left is a media query list, which calls no function.
  if (/(^|[\s,(])[a-z-]+\(/i.test(rest)) return undefined
  if (rest) parsed.media = rest

  return parsed
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

// The files a request could name, or none for a request that is not a path
// in the project: a URL with a scheme, a package, an alias.
function importCandidates(
  request: string,
  issuerDir: string,
  roots: string[]
): string[] {
  const req = request.split('?')[0].split('#')[0]

  if (!req || req.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(req)) {
    return []
  }

  if (req.startsWith('~') || req.startsWith('@') || request.includes('!')) {
    return []
  }

  const named = req.startsWith('/')
    ? roots.map((root) => path.join(root, req.slice(1)))
    : [path.resolve(issuerDir, req)]

  return path.extname(req)
    ? named
    : [...named, ...named.map((file) => `${file}.css`)]
}

// A relative url() in an imported sheet is written from that sheet's folder,
// and its text now sits in a sheet that lives somewhere else.
function rebaseUrls(css: string, fromDir: string, toDir: string): string {
  if (fromDir === toDir) return css

  return replaceCssUrlRefs(css, (request) => {
    if (
      !request ||
      /^[/#~@]/.test(request) ||
      /^[a-z][a-z0-9+.-]*:/i.test(request)
    ) {
      return undefined
    }

    const suffixAt = request.search(/[?#]/)
    const req = suffixAt === -1 ? request : request.slice(0, suffixAt)
    const suffix = suffixAt === -1 ? '' : request.slice(suffixAt)
    const moved = toPosixPath(path.relative(toDir, path.resolve(fromDir, req)))

    return `${moved.startsWith('../') ? moved : `./${moved}`}${suffix}`
  })
}

function wrap(css: string, rule: ParsedImport): string {
  let wrapped = css

  if (rule.media) wrapped = `@media ${rule.media} {\n${wrapped}\n}`

  if (rule.supports !== undefined) {
    const condition = /^[\w-]+\s*:/.test(rule.supports)
      ? `(${rule.supports})`
      : rule.supports

    wrapped = `@supports ${condition} {\n${wrapped}\n}`
  }

  if (rule.layer !== undefined) {
    wrapped = `@layer${rule.layer ? ` ${rule.layer}` : ''} {\n${wrapped}\n}`
  }

  return wrapped
}

interface Inlining {
  roots: string[]
  files: Set<string>
  missing: Set<string>
  unreadable: InlinedCssImports['unreadable']
}

// The sheet with every @import of a project .css file replaced by that
// file's rules. `kept` collects the imports that stay, to open the result.
function inlineSheet(
  css: string,
  file: string,
  chain: string[],
  state: Inlining,
  kept: string[] | undefined
): string | undefined {
  let root: Root

  try {
    root = postcss.parse(css, {from: file})
  } catch {
    return undefined
  }

  const issuerDir = path.dirname(file)
  const firstBlock = root.nodes.findIndex((node) =>
    Array.isArray((node as {nodes?: unknown}).nodes)
  )
  const edits: Array<{start: number; end: number; text: string}> = []

  root.nodes.forEach((node, index) => {
    if (node.type !== 'atrule' || node.name.toLowerCase() !== 'import') return
    // A browser skips an @import that follows a rule, and so does this step.
    if (firstBlock !== -1 && index > firstBlock) return

    const rule = node as AtRule
    const start = rule.source?.start?.offset
    const end = rule.source?.end?.offset
    if (typeof start !== 'number' || typeof end !== 'number') return

    const parsed = parseImport(rule.params)
    const candidates = parsed
      ? importCandidates(parsed.request, issuerDir, state.roots)
      : []
    const target = candidates.find(
      (candidate) => /\.css$/i.test(candidate) && isFile(candidate)
    )

    if (!parsed || !target) {
      // A bare name is most often a package, which no project path awaits.
      const namesPath = parsed && /^\.{0,2}\//.test(parsed.request)

      for (const candidate of namesPath ? candidates : []) {
        if (!fs.existsSync(candidate)) state.missing.add(candidate)
      }

      // Once another sheet's rules come in, an @import that stays would
      // follow a rule, so it moves to the head of the result.
      if (kept) {
        kept.push(css.slice(start, end))
        edits.push({start, end, text: ''})
      }

      return
    }

    // A sheet that imports itself, however far down, adds nothing new.
    if (chain.includes(target)) {
      edits.push({start, end, text: ''})

      return
    }

    let inner: string | undefined

    try {
      inner = inlineSheet(
        fs.readFileSync(target, 'utf8').replace(/^﻿/, ''),
        target,
        [...chain, target],
        state,
        parsed.media ||
          parsed.supports !== undefined ||
          parsed.layer !== undefined
          ? undefined
          : (kept ?? [])
      )
    } catch (error) {
      state.unreadable.push({
        request: parsed.request,
        file: target,
        reason: error instanceof Error ? error.message : String(error)
      })

      return
    }

    if (inner === undefined) {
      state.unreadable.push({
        request: parsed.request,
        file: target,
        reason: 'The file is not valid CSS.'
      })

      return
    }

    state.files.add(target)
    edits.push({
      start,
      end,
      text: wrap(
        rebaseUrls(inner, path.dirname(target), issuerDir).replace(
          /@charset\s+[^;]+;/gi,
          ''
        ),
        parsed
      )
    })
  })

  let out = css

  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }

  return out
}

// A content-script sheet reaches the page as one data: URL, where a relative
// @import has no base to resolve from, so the imported rules come in here.
export function inlineCssImports(
  source: string,
  context: InlineCssImportsContext
): InlinedCssImports {
  const state: Inlining = {
    roots: context.roots,
    files: new Set(),
    missing: new Set(),
    unreadable: []
  }
  const untouched: InlinedCssImports = {
    css: source,
    files: [],
    missing: [],
    unreadable: []
  }

  if (!/@import/i.test(source)) return untouched

  const kept: string[] = []
  const css = inlineSheet(
    source,
    context.resourcePath,
    [context.resourcePath],
    state,
    kept
  )

  // Nothing came in, so nothing has to move: the sheet stays as written.
  if (css === undefined || state.files.size === 0) {
    return {
      ...untouched,
      missing: [...state.missing],
      unreadable: state.unreadable
    }
  }

  return {
    // An import that stays has to lead the sheet, or the browser skips it.
    css: kept.length > 0 ? `${kept.join('\n')}\n${css}` : css,
    files: [...state.files],
    missing: [...state.missing],
    unreadable: state.unreadable
  }
}
