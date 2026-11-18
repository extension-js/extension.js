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
import {replaceCssUrlRefs, toPosixPath} from './dead-url-refs'

export interface InlineCssImportsContext {
  resourcePath: string
  // Where a root-absolute request can live: the public folder, then the
  // manifest folder, the order every other reference check uses.
  roots: string[]
}

export interface PlacedCssImport {
  // The @import as it reads in the result.
  statement: string
  // The sheet it was written in.
  file: string
}

export interface InlinedCssImports {
  css: string
  // Every sheet whose text is now part of this one.
  files: string[]
  // Every place a sheet that was not found could appear later.
  missing: string[]
  // A sheet that was found and could not be read as CSS.
  unreadable: Array<{request: string; file: string; reason: string}>
  // An import that now leads rules it used to follow.
  moved: PlacedCssImport[]
  // An import left inside a block, where a browser skips it.
  skipped: PlacedCssImport[]
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

  // What is left is a media query list, which calls no function.
  if (/(^|[\s,(])[a-z-]+\(/i.test(rest)) return {request, opaque: tail}
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

// One set of conditions that says what the nested ones say together, or
// undefined when an @import has no way to write that.
function combineConditions(
  outer: ImportConditions[],
  own: ImportConditions
): ImportConditions | undefined {
  const combined: ImportConditions = {}
  const frames = [...outer, own]
  const outerLayers = outer.flatMap((frame) =>
    frame.layer === undefined ? [] : [frame.layer]
  )

  // An unnamed layer is a new one each time it is written, so an import
  // has no way to name one that a block opened, or one inside another.
  if (outerLayers.includes('')) return undefined
  if (own.layer === '' && outerLayers.length > 0) return undefined

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
    const typed = media.filter((query) => !query.startsWith('('))
    const features = media.filter((query) => query.startsWith('('))

    if (
      typed.length > 1 ||
      media.some((query) => query.includes(',')) ||
      typed.some((query) => /^not\b/i.test(query)) ||
      features.some((query) => /\bor\b/i.test(query))
    ) {
      return undefined
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

// A relative request is written from its own sheet's folder, and its text
// now sits in a sheet that lives somewhere else.
function rebaseRequest(request: string, fromDir: string, toDir: string) {
  const suffixAt = request.search(/[?#]/)
  const req = suffixAt === -1 ? request : request.slice(0, suffixAt)
  const suffix = suffixAt === -1 ? '' : request.slice(suffixAt)
  const moved = toPosixPath(path.relative(toDir, path.resolve(fromDir, req)))

  return `${moved.startsWith('../') ? moved : `./${moved}`}${suffix}`
}

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
  // The folder of the sheet every other one comes into.
  topDir: string
  files: Set<string>
  missing: Set<string>
  unreadable: InlinedCssImports['unreadable']
  // The imports that stay, in the order they were met, to lead the result.
  kept: string[]
  moved: PlacedCssImport[]
  skipped: PlacedCssImport[]
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

// The sheet with every @import of a project .css file replaced by that
// file's rules. `frames` holds the conditions of each import on the way here.
function inlineSheet(
  css: string,
  file: string,
  chain: string[],
  state: Inlining,
  frames: ImportConditions[]
): string | undefined {
  let root: Root

  try {
    root = postcss.parse(css, {from: file})
  } catch {
    return undefined
  }

  const top = chain.length === 1
  const issuerDir = path.dirname(file)
  const firstBlock = root.nodes.findIndex((node) =>
    Array.isArray((node as {nodes?: unknown}).nodes)
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
    if (firstBlock !== -1 && index > firstBlock) return

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
    const candidates =
      parsed && !parsed.opaque
        ? importCandidates(parsed.request, issuerDir, state.roots)
        : []
    const target = candidates.find(
      (candidate) => /\.css$/i.test(candidate) && isFile(candidate)
    )

    if (!parsed || !target) {
      const written = `${css.slice(start, end).replace(/;$/, '').trim()};`
      // A bare name is most often a package, which no project path awaits.
      const relative = parsed !== undefined && /^\.{1,2}\//.test(parsed.request)
      const namesPath = relative || parsed?.request.startsWith('/')

      for (const candidate of namesPath ? candidates : []) {
        if (!fs.existsSync(candidate)) state.missing.add(candidate)
      }

      // Once another sheet's rules come in, an @import that stays would
      // follow a rule, so it leads the result under the conditions it had.
      const conditions =
        parsed && !(parsed.opaque && frames.length > 0)
          ? combineConditions(frames, parsed)
          : frames.length === 0
            ? {}
            : undefined

      if (!conditions) {
        state.skipped.push({statement: written, file})

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

    // A sheet that imports itself, however far down, adds nothing new.
    if (chain.includes(target)) {
      edits.push({start, end, text: ''})

      return
    }

    let inner: string | undefined

    try {
      inner = inlineSheet(
        fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''),
        target,
        [...chain, target],
        state,
        isConditional(parsed) ? [...frames, parsed] : frames
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
    topDir: path.dirname(context.resourcePath),
    files: new Set(),
    missing: new Set(),
    unreadable: [],
    kept: [],
    moved: [],
    skipped: [],
    orderedLayers: new Set(),
    filledLayers: new Set()
  }
  const untouched: InlinedCssImports = {
    css: source,
    files: [],
    missing: [],
    unreadable: [],
    moved: [],
    skipped: []
  }

  if (!/@import/i.test(source)) return untouched

  // The parser drops a byte order mark and counts every place without it.
  const css = inlineSheet(
    source.replace(/^\uFEFF/, ''),
    context.resourcePath,
    [context.resourcePath],
    state,
    []
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
    css,
    files: [...state.files],
    missing: [...state.missing],
    unreadable: state.unreadable,
    moved: state.moved,
    skipped: state.skipped
  }
}
