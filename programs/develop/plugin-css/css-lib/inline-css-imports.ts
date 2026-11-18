//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import postcss, {type AtRule, type ChildNode, type Root} from 'postcss'
import {cssUrlRefFiles, toPosixPath} from './dead-url-refs'

export interface InlineCssImportsContext {
  resourcePath: string
  // Where a root-absolute request can live: the public folder, then the
  // manifest folder, the order every other reference check uses.
  roots: string[]
  // No sheet from outside this folder comes in.
  projectPath: string
}

export interface PlacedCssImport {
  // The @import as it reads in the result.
  statement: string
  // The sheet it was written in.
  file: string
}

// Why an import could not carry the conditions its sheet came in under.
export type CssImportSkipReason =
  | 'unnamed-layer'
  | 'media-never'
  | 'media-not-joined'
  | 'unknown-function'

export interface SkippedCssImport extends PlacedCssImport {
  why: CssImportSkipReason
}

export interface InlinedCssImports {
  css: string
  // Every sheet whose text is now part of this one.
  files: string[]
  // Every place a sheet that was not found could appear later.
  missing: string[]
  // A sheet that was found and did not come in: one that is not valid CSS,
  // or one this step may not read. `fix` is there when the reason has its own.
  unreadable: Array<{
    request: string
    file: string
    reason: string
    fix?: string
  }>
  // An import that now leads rules it used to follow.
  moved: PlacedCssImport[]
  // An import of an address left inside a block, where a browser skips it.
  skipped: SkippedCssImport[]
  // An import with no ./ ahead of a name a file beside the sheet also has.
  bare: PlacedCssImport[]
  // Each run of sheets that import one another, closed by its first sheet.
  cycles: string[][]
}

interface ImportConditions {
  layer?: string
  supports?: string
  media?: string
}

interface ParsedImport extends ImportConditions {
  request: string
  // What follows the target when it holds a function CSS does not define.
  // Such an import is left to the browser or to a plugin.
  opaque?: string
}

// Either order of the mark. The parser drops both.
const BYTE_ORDER_MARK = /^[\uFEFF\uFFFE]/

const IMPORT_TARGET =
  /^(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)|"([^"]*)"|'([^']*)')\s*([\s\S]*)$/i

const MEDIA_MATH = new Set(
  'calc min max clamp round mod rem sin cos tan asin acos atan atan2 pow sqrt hypot log exp abs sign env'.split(
    ' '
  )
)

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

// Undefined for an import whose target cannot be read at all.
function parseImport(params: string): ParsedImport | undefined {
  const match = IMPORT_TARGET.exec(params.trim())
  if (!match) return undefined

  const request = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
  const tail = (match[6] || '').trim()
  let rest = tail
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

  // What is left is a media query list, where only math is a function.
  const called = rest.match(/[a-z-][\w-]*(?=\()/gi) ?? []

  if (called.some((name) => !MEDIA_MATH.has(name.toLowerCase()))) {
    return {request, opaque: tail}
  }

  if (rest) parsed.media = rest

  return parsed
}

function isConditional(rule: ImportConditions): boolean {
  return Boolean(
    rule.media || rule.supports !== undefined || rule.layer !== undefined
  )
}

function supportsCondition(supports: string): string {
  return /^[\w-]+\s*:/.test(supports) ? `(${supports})` : supports
}

// Whether a comma splits the text into several queries. One inside the
// parentheses of a function splits nothing.
function isQueryList(media: string): boolean {
  let depth = 0

  for (const char of media) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) return true
  }

  return false
}

// The media type a query opens with, or none for a query of features alone.
function mediaType(query: string): string | undefined {
  return /^(?:only\s+)?([a-z-]+)/i.exec(query)?.[1].toLowerCase()
}

// One set of conditions that says what the nested ones say together, or
// the reason an @import has no way to write that.
function combineConditions(
  outer: ImportConditions[],
  own: ImportConditions
): ImportConditions | CssImportSkipReason {
  const combined: ImportConditions = {}
  const frames = [...outer, own]
  const outerLayers = outer.flatMap((frame) =>
    frame.layer === undefined ? [] : [frame.layer]
  )

  // An unnamed layer is a new one each time it is written, so an import
  // has no way to name one that a block opened, or one inside another.
  if (outerLayers.includes('')) return 'unnamed-layer'
  if (own.layer === '' && outerLayers.length > 0) return 'unnamed-layer'

  if (own.layer !== undefined || outerLayers.length > 0) {
    combined.layer = [
      ...outerLayers,
      ...(own.layer === undefined ? [] : [own.layer])
    ].join('.')
  }

  const supports = frames.flatMap((frame) =>
    frame.supports === undefined ? [] : [frame.supports]
  )
  const media = frames.flatMap((frame) => (frame.media ? [frame.media] : []))

  if (supports.length === 1) combined.supports = supports[0]

  if (supports.length > 1) {
    combined.supports = supports.map((one) => `(${one})`).join(' and ')
  }

  if (media.length === 1) combined.media = media[0]

  if (media.length > 1) {
    // Only a plain list of features can be joined with "and".
    let typed = media.filter((query) => !query.startsWith('('))
    const features = media.filter((query) => query.startsWith('('))

    if (
      media.some(isQueryList) ||
      typed.some((query) => /^not\b/i.test(query)) ||
      features.some((query) => /\bor\b/i.test(query))
    ) {
      return 'media-not-joined'
    }

    if (typed.length > 1) {
      const types = new Set(typed.map(mediaType))

      // No device is two media types at once.
      if (types.size > 1 && !types.has('all')) return 'media-never'

      // The same type said twice with nothing else is that type once.
      if (types.size > 1 || typed.some((query) => /\s/.test(query))) {
        return 'media-not-joined'
      }

      typed = [typed[0]]
    }

    combined.media = [...typed, ...features].join(' and ')
  }

  return combined
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function realPath(file: string): string {
  try {
    return fs.realpathSync(file)
  } catch {
    return path.resolve(file)
  }
}

const KEEP_IN_PROJECT =
  'Keep the sheets a content script stylesheet imports inside the project, outside node_modules and folders that start with a dot.'

// Whether the rules of a sheet may be read into another one: undefined when
// they may, or the reason they may not. Links are followed before the check.
function whyNotRead(file: string, projectRoot: string): string | undefined {
  const inside = path.relative(realPath(projectRoot), realPath(file))
  const parts = inside.split(path.sep)

  if (!inside || parts[0] === '..' || path.isAbsolute(inside)) {
    return 'The file is outside the project.'
  }

  const folders = parts.slice(0, -1)

  if (folders.includes('node_modules')) {
    return 'The file belongs to a package in node_modules.'
  }

  const hidden = folders.find((folder) => folder.startsWith('.'))

  return hidden
    ? `The file is inside ${hidden}, a folder the build does not read.`
    : undefined
}

// A relative request is written from its own sheet's folder, and its text
// now sits in a sheet that lives somewhere else.
function rebaseRequest(request: string, fromDir: string, toDir: string) {
  const suffixAt = request.search(/[?#]/)
  const req = suffixAt === -1 ? request : request.slice(0, suffixAt)
  const suffix = suffixAt === -1 ? '' : request.slice(suffixAt)
  const moved = toPosixPath(path.relative(toDir, path.resolve(fromDir, req)))

  return `${moved.startsWith('../') ? moved : `./${moved}`}${suffix}`
}

// Where the string that opens at `at` ends, its closing quote included.
function stringEnd(css: string, at: number): number {
  const quote = css[at]
  let end = at + 1

  while (end < css.length && css[end] !== quote && css[end] !== '\n') {
    end += css[end] === '\\' ? 2 : 1
  }

  return Math.min(end + 1, css.length)
}

const IDENT = /[a-z_-][\w-]*/iy
const URL_STRING_FUNCTIONS = new Set(['url', 'image-set', '-webkit-image-set'])

// The sheet with each address it names passed through `rewrite`. Reads the
// text the way CSS does, so a url( inside a string or a comment is left.
function rewriteCssUrls(
  css: string,
  rewrite: (request: string, isImport: boolean) => string | undefined
): string {
  const functions: string[] = []
  let out = ''
  let copied = 0
  let at = 0
  let inImport = false

  const put = (start: number, end: number, request: string, quote?: string) => {
    const next = request.includes('\\') ? undefined : rewrite(request, inImport)
    if (next === undefined) return

    const text = quote
      ? next.split(quote).join(`\\${quote}`)
      : /[\s()'"]/.test(next)
        ? `"${next.split('"').join('\\"')}"`
        : next

    out += css.slice(copied, start) + text
    copied = end
  }

  while (at < css.length) {
    const char = css[at]

    if (char === '\\') {
      at += 2
    } else if (char === '/' && css[at + 1] === '*') {
      const end = css.indexOf('*/', at + 2)

      at = end === -1 ? css.length : end + 2
    } else if (char === '"' || char === "'") {
      const end = stringEnd(css, at)
      const closed = css[end - 1] === char && end - 1 > at
      const named = functions[functions.length - 1]

      // A string is an address after @import and inside these functions.
      if (
        closed &&
        (named === undefined ? inImport : URL_STRING_FUNCTIONS.has(named))
      ) {
        put(at + 1, end - 1, css.slice(at + 1, end - 1), char)
      }

      if (named === undefined) inImport = false

      at = end
    } else if (char === '(') {
      functions.push('')
      at++
    } else if (char === ')') {
      functions.pop()
      at++
    } else if (char === ';' || char === '{' || char === '}') {
      functions.length = 0
      inImport = false
      at++
    } else if (char === '@') {
      IDENT.lastIndex = at + 1
      const name = IDENT.exec(css)?.[0] ?? ''

      inImport = name.toLowerCase() === 'import'
      at += name.length + 1
    } else {
      IDENT.lastIndex = at
      const name = IDENT.exec(css)?.[0]

      if (!name) {
        at++
      } else if (css[at + name.length] !== '(') {
        at += name.length
      } else if (name.toLowerCase() !== 'url') {
        functions.push(name.toLowerCase())
        at += name.length + 1
      } else {
        let start = at + name.length + 1

        while (/\s/.test(css[start] ?? '')) start++

        if (css[start] === '"' || css[start] === "'") {
          functions.push('url')
          at = start
        } else {
          // An unquoted address runs to the closing parenthesis.
          const close = css.indexOf(')', start)
          const end = close === -1 ? css.length : close
          const request = css.slice(start, end).trim()

          if (request) put(start, start + request.length, request)

          inImport = false
          at = Math.min(end + 1, css.length)
        }
      }
    }
  }

  return out + css.slice(copied)
}

function rebaseUrls(css: string, fromDir: string, toDir: string): string {
  if (fromDir === toDir) return css

  return rewriteCssUrls(css, (request, isImport) => {
    if (
      !request ||
      /^[/#~@]/.test(request) ||
      /^[a-z][a-z0-9+.-]*:/i.test(request)
    ) {
      return undefined
    }

    // After @import a name with no ./ ahead of it is a package.
    if (isImport && !/^\.{1,2}\//.test(request)) return undefined

    return rebaseRequest(request, fromDir, toDir)
  })
}

function wrap(css: string, rule: ImportConditions): string {
  let wrapped = css

  if (rule.media) wrapped = `@media ${rule.media} {\n${wrapped}\n}`

  if (rule.supports !== undefined) {
    wrapped = `@supports ${supportsCondition(rule.supports)} {\n${wrapped}\n}`
  }

  if (rule.layer !== undefined) {
    wrapped = `@layer${rule.layer ? ` ${rule.layer}` : ''} {\n${wrapped}\n}`
  }

  return wrapped
}

function importStatement(
  request: string,
  rule: ImportConditions & {opaque?: string}
): string {
  const quote = request.includes('"') ? "'" : '"'
  const parts = [`@import ${quote}${request}${quote}`]

  if (rule.opaque) parts.push(rule.opaque)

  if (rule.layer !== undefined) {
    parts.push(rule.layer ? `layer(${rule.layer})` : 'layer')
  }

  if (rule.supports !== undefined) parts.push(`supports(${rule.supports})`)
  if (rule.media) parts.push(rule.media)

  return `${parts.join(' ')};`
}

interface Inlining {
  roots: string[]
  projectPath: string
  // The folder of the sheet every other one comes into.
  topDir: string
  files: Set<string>
  missing: Set<string>
  unreadable: InlinedCssImports['unreadable']
  // The imports that stay, in the order they were met, to lead the result.
  kept: string[]
  moved: PlacedCssImport[]
  skipped: SkippedCssImport[]
  bare: PlacedCssImport[]
  cycles: string[][]
  // Layers whose order the first sheet states before anything else.
  orderedLayers: Set<string>
  // Layers that rules of a sheet that came in already sit in.
  filledLayers: Set<string>
}

// Notes each named layer the rules of a sheet that came in now sit in: the
// one its import named, and each @layer block the sheet opens itself.
function noteFilledLayers(
  root: Root,
  frames: ImportConditions[],
  state: Inlining
) {
  const outer = frames.flatMap((frame) =>
    frame.layer === undefined ? [] : [frame.layer]
  )

  // Nothing can name a layer inside an unnamed one.
  if (outer.includes('')) return
  if (outer.length > 0) state.filledLayers.add(outer.join('.'))

  const visit = (nodes: ChildNode[], path: string[]) => {
    for (const node of nodes) {
      if (node.type !== 'atrule' || !node.nodes) continue

      const name =
        node.name.toLowerCase() === 'layer' ? node.params.trim() : undefined
      // An unnamed block hides everything inside it the same way.
      if (name === '') continue

      const inner = name ? [...path, name] : path

      if (name) state.filledLayers.add(inner.join('.'))

      visit(node.nodes, inner)
    }
  }

  visit(root.nodes, outer)
}

interface NotInlined {
  reason: string
  fix?: string
}

const IMPORT_RUN = new Set(['charset', 'import'])

// The sheet with every @import of a project .css file replaced by that
// file's rules. `frames` holds the conditions of each import on the way here,
// and `chain` the sheets on the way here, each by the file it really is.
function inlineSheet(
  css: string,
  file: string,
  chain: string[],
  state: Inlining,
  frames: ImportConditions[]
): string | NotInlined {
  let root: Root

  try {
    root = postcss.parse(css, {from: file})
  } catch {
    return {reason: 'The file is not valid CSS.'}
  }

  const top = chain.length === 1
  const issuerDir = path.dirname(file)
  // @namespace has to lead every rule of its sheet and speaks for that
  // sheet alone, so such a sheet neither moves into another nor takes one in.
  const namespaced = root.nodes.some(
    (node) => node.type === 'atrule' && node.name.toLowerCase() === 'namespace'
  )

  if (namespaced && !top) {
    return {
      reason:
        'The file sets an @namespace, which reads differently once its rules sit in another stylesheet.',
      fix: 'Import that file from the script instead, or move its @namespace rules out of it.'
    }
  }

  let toldNamespace = false
  // A browser reads an @import only ahead of every rule: comments, @charset,
  // other imports and a list of layer names are all that may come before it.
  const runEnd = root.nodes.findIndex(
    (node) =>
      node.type !== 'comment' &&
      !(
        node.type === 'atrule' &&
        (IMPORT_RUN.has(node.name.toLowerCase()) ||
          (node.name.toLowerCase() === 'layer' && !node.nodes))
      )
  )
  const edits: Array<{start: number; end: number; text: string}> = []
  // Where an import that stays goes: a browser reads @charset and a list of
  // layer names ahead of every @import, and the list sets the layer order.
  let head = 0

  if (top) {
    for (const node of root.nodes) {
      if (node.type === 'comment') continue

      const name = node.type === 'atrule' ? node.name.toLowerCase() : ''
      const end = node.source?.end?.offset
      const statement =
        node.type === 'atrule' &&
        (name === 'charset' || (name === 'layer' && !node.nodes))
      if (!statement || typeof end !== 'number') break

      head = end

      if (name === 'layer') {
        for (const layer of node.params.split(',')) {
          state.orderedLayers.add(layer.trim())
        }
      }
    }
  }

  // Lists of layer names met so far that are not at the head of the result.
  // An import that goes there would otherwise jump ahead of the order they set.
  let layerLists: Array<{start: number; end: number; names: string[]}> = []

  root.nodes.forEach((node, index) => {
    if (node.type !== 'atrule') return
    // A browser skips an @import that follows a rule, and so does this step.
    if (runEnd !== -1 && index > runEnd) return

    const rule = node as AtRule
    const start = rule.source?.start?.offset
    const end = rule.source?.end?.offset
    if (typeof start !== 'number' || typeof end !== 'number') return

    if (node.name.toLowerCase() === 'layer' && !node.nodes) {
      if (!top || start >= head) {
        layerLists.push({
          start,
          end,
          names: node.params.split(',').map((name) => name.trim())
        })
      }

      return
    }

    if (node.name.toLowerCase() !== 'import') return

    const parsed = parseImport(rule.params)
    // The one rule for which files a request names. A name with no ./
    // ahead of it is a package there, never a file beside the sheet.
    const candidates =
      parsed && !parsed.opaque && !parsed.request.includes('!')
        ? cssUrlRefFiles(parsed.request, {issuerDir, roots: state.roots})
        : []
    const target = candidates.find(
      (candidate) => /\.css$/i.test(candidate) && isFile(candidate)
    )

    if (!parsed || !target) {
      const written = `${css.slice(start, end).replace(/;$/, '').trim()};`
      const relative = parsed !== undefined && /^\.{1,2}\//.test(parsed.request)

      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) state.missing.add(candidate)
      }

      if (
        parsed &&
        !parsed.opaque &&
        /^[\w-][^:?#!]*\.css$/i.test(parsed.request) &&
        isFile(path.resolve(issuerDir, parsed.request))
      ) {
        state.bare.push({statement: written, file})
      }

      // Once another sheet's rules come in, an @import that stays would
      // follow a rule, so it leads the result under the conditions it had.
      const conditions =
        parsed && !(parsed.opaque && frames.length > 0)
          ? combineConditions(frames, parsed)
          : frames.length === 0
            ? {}
            : 'unknown-function'

      if (typeof conditions === 'string') {
        // A package name left in a block is for a PostCSS plugin to bring
        // in, as the one at the head is. An address is for the browser,
        // which skips an @import inside a block.
        if (
          !parsed ||
          /^(?:[a-z][a-z0-9+.-]*:|\.{0,2}\/)/i.test(parsed.request)
        ) {
          state.skipped.push({statement: written, file, why: conditions})
        }

        return
      }

      const request =
        relative && parsed && issuerDir !== state.topDir
          ? rebaseRequest(parsed.request, issuerDir, state.topDir)
          : parsed?.request
      const statement =
        parsed && (frames.length > 0 || request !== parsed.request)
          ? importStatement(request ?? parsed.request, {
              ...conditions,
              opaque: parsed.opaque
            })
          : written

      // A list of layer names this import followed goes to the head with
      // it, under the layer its sheet came in with. A list cannot carry a
      // media or supports condition, nor a name inside an unnamed layer.
      const outerLayers = frames.flatMap((frame) =>
        frame.layer === undefined ? [] : [frame.layer]
      )
      const listsCanMove = !frames.some(
        (frame) =>
          frame.media || frame.supports !== undefined || frame.layer === ''
      )
      const listsMoved = layerLists.length > 0 && listsCanMove
      const listsLeft = layerLists.length > 0 && !listsCanMove

      if (listsMoved) {
        for (const list of layerLists) {
          const names = list.names.map((name) =>
            [...outerLayers, name].join('.')
          )

          state.kept.push(`@layer ${names.join(', ')};`)
          edits.push({start: list.start, end: list.end, text: ''})
        }

        layerLists = []
      }

      // The opening list of the first sheet fixes where each layer sits,
      // and not the order of two sources inside one of them.
      const layer = conditions.layer
      const orderHolds =
        Boolean(layer) &&
        state.orderedLayers.has(layer as string) &&
        ![...state.filledLayers].some(
          (filled) =>
            filled === layer || (layer as string).startsWith(`${filled}.`)
        )

      if (listsLeft || (state.files.size > 0 && (listsMoved || !orderHolds))) {
        state.moved.push({statement, file})
      }

      state.kept.push(statement)
      edits.push({start, end, text: ''})

      return
    }

    if (namespaced) {
      if (!toldNamespace) {
        state.unreadable.push({
          request: parsed.request,
          file: target,
          reason:
            'This stylesheet sets an @namespace, which has to come before every rule, so no imported rules can come in ahead of it.',
          fix: 'Import that file from the script instead, or move the @namespace rules to a sheet of their own.'
        })
      }

      toldNamespace = true

      return
    }

    const real = realPath(target)

    // A sheet that imports itself, however far down, adds nothing new.
    if (chain.includes(real)) {
      state.cycles.push([...chain.slice(chain.indexOf(real)), real])
      edits.push({start, end, text: ''})

      return
    }

    const refused = whyNotRead(target, state.projectPath)

    if (refused) {
      state.unreadable.push({
        request: parsed.request,
        file: target,
        reason: refused,
        fix: KEEP_IN_PROJECT
      })

      return
    }

    let inner: string | NotInlined

    try {
      inner = inlineSheet(
        fs.readFileSync(target, 'utf8').replace(BYTE_ORDER_MARK, ''),
        target,
        [...chain, real],
        state,
        isConditional(parsed) ? [...frames, parsed] : frames
      )
    } catch (error) {
      inner = {reason: error instanceof Error ? error.message : String(error)}
    }

    if (typeof inner !== 'string') {
      state.unreadable.push({request: parsed.request, file: target, ...inner})

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

  if (!top) noteFilledLayers(root, frames, state)

  if (top && state.kept.length > 0) {
    const lines = state.kept.join('\n')

    edits.push({
      start: head,
      end: head,
      text: head === 0 ? `${lines}\n` : `\n${lines}`
    })
  }

  let out = css

  // From the end back, and a removal ahead of what goes in at its start.
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
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
    projectPath: context.projectPath,
    topDir: path.dirname(context.resourcePath),
    files: new Set(),
    missing: new Set(),
    unreadable: [],
    kept: [],
    moved: [],
    skipped: [],
    bare: [],
    cycles: [],
    orderedLayers: new Set(),
    filledLayers: new Set()
  }

  if (!/@import/i.test(source)) {
    return {
      css: source,
      files: [],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    }
  }

  // The parser drops a byte order mark and counts every place without it.
  const css = inlineSheet(
    source.replace(BYTE_ORDER_MARK, ''),
    context.resourcePath,
    [realPath(context.resourcePath)],
    state,
    []
  )

  return {
    // Nothing came in, so nothing has to move: the sheet stays as written.
    css: typeof css !== 'string' || state.files.size === 0 ? source : css,
    files: [...state.files],
    missing: [...state.missing],
    unreadable: state.unreadable,
    moved: state.moved,
    skipped: state.skipped,
    bare: state.bare,
    cycles: state.cycles
  }
}
