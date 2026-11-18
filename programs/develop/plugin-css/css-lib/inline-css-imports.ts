//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
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
  | 'no-target'

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
    // The sheet the @import was written in.
    from: string
    reason: string
    fix?: string
  }>
  // An import that now leads rules it used to follow.
  moved: PlacedCssImport[]
  // An import of an address left inside a block, where a browser skips it.
  skipped: SkippedCssImport[]
  // Each file an import that stays names and a reason above speaks for, and
  // each statement with no target that one does.
  answered: string[]
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
  // Written as url(), which names a path and never a package.
  viaUrl?: boolean
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
  const viaUrl = match[4] === undefined && match[5] === undefined
  const parsed: ParsedImport = viaUrl ? {request, viaUrl} : {request}

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
    return viaUrl ? {request, viaUrl, opaque: tail} : {request, opaque: tail}
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
    const types = media.filter((query) => !query.startsWith('('))
    // `all` beside another type says nothing the other does not.
    const narrow = types.filter((query) => !/^all$/i.test(query.trim()))
    let typed = narrow.length > 0 ? narrow : types
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

// Whether a file sits at this path from the folder under exactly these
// names. A disk that ignores letter case opens it under any spelling.
function isFileNamedExactly(folder: string, relative: string): boolean {
  let at = folder

  for (const name of relative.split('/')) {
    if (name !== '..' && name !== '.') {
      try {
        if (!fs.readdirSync(at).includes(name)) return false
      } catch {
        return false
      }
    }

    at = path.join(at, name)
  }

  return isFile(at)
}

function realPath(file: string): string {
  try {
    // The native call answers in the letter case the disk holds.
    return fs.realpathSync.native(file)
  } catch {
    return path.resolve(file)
  }
}

// Whole names of a file or a folder that no build reads, in any letter
// case. `*` stands for any run of characters.
const PRIVATE_NAMES = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.env',
  '.envrc',
  '.git',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.gitkeep',
  '.npmrc',
  '.yarnrc.yml',
  '.*.swp',
  '.*.swo',
  '.*.swn',
  '*~'
].map(
  (name) =>
    new RegExp(
      `^${name
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
      'i'
    )
)

// `.env.<anything>` is an env file, except a template a project commits to
// document its keys.
const ENV_TEMPLATE_ENDINGS = ['.example', '.sample', '.template']

function isPrivateName(name: string): boolean {
  const lower = name.toLowerCase()

  if (lower.startsWith('.env.')) {
    return !ENV_TEMPLATE_ENDINGS.some((ending) => lower.endsWith(ending))
  }

  return PRIVATE_NAMES.some((matcher) => matcher.test(name))
}

const KEEP_IN_PROJECT =
  'Keep the sheets a content script stylesheet imports inside the project or its workspace, or in a package it installs.'
const NO_PRIVATE_NAME =
  'Give the sheet a path with no private file or folder name along it.'

// Whether a path is inside the node_modules of one of these folders or of a
// folder above one, where a package manager keeps what a project installed.
function inInstalledModules(file: string, folders: string[]): boolean {
  const parts = file.split(path.sep)
  const modulesAt = parts.indexOf('node_modules')
  if (modulesAt === -1) return false

  // Windows spells one drive in either letter case.
  const spelled = (folder: string) =>
    process.platform === 'win32' ? folder.toLowerCase() : folder
  const owner = spelled(parts.slice(0, modulesAt).join(path.sep))

  // The root of a disk owns no project, whatever sits in its node_modules.
  if (owner === '' || /^[a-z]:$/i.test(owner)) return false

  return folders
    .map(spelled)
    .some(
      (folder) => folder === owner || folder.startsWith(`${owner}${path.sep}`)
    )
}

// Whether a folder declares a workspace the way pnpm, npm, Yarn and Bun read one.
function declaresWorkspace(dir: string): boolean {
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return true

  try {
    const {workspaces} = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    )

    return Array.isArray(workspaces) || Array.isArray(workspaces?.packages)
  } catch {
    return false
  }
}

const workspaceRoots = new Map<string, string>()

// Whether a folder is the home folder or one that holds it.
function isHomeOrAbove(dir: string, home: string): boolean {
  const down = path.relative(dir, home)

  return !down.startsWith('..') && !path.isAbsolute(down)
}

// The nearest folder at or above the project that declares a workspace, or
// the project itself. A marker in the home folder or above it is not read.
export function workspaceRootOf(
  projectRoot: string,
  homeDir: string = os.homedir()
): string {
  const root = realPath(projectRoot)
  const home = realPath(homeDir)
  const key = `${root}\0${home}`
  const cached = workspaceRoots.get(key)
  if (cached !== undefined) return cached

  let found = root

  for (let dir = root; !isHomeOrAbove(dir, home); dir = path.dirname(dir)) {
    if (declaresWorkspace(dir)) {
      found = dir
      break
    }

    if (path.dirname(dir) === dir) break
  }

  workspaceRoots.set(key, found)

  return found
}

// Whether a path inside the workspace stays clear of what a package manager
// or a tool keeps: any node_modules or dot-named part, the file name included.
function inWorkspaceSources(file: string, workspaceRoot: string): boolean {
  const inside = path.relative(workspaceRoot, file)

  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    return false
  }

  return !inside
    .split(path.sep)
    .some((part) => part === 'node_modules' || /^\.(?!\.?$)/.test(part))
}

// Whether the rules of a sheet may be read into another one: undefined when
// they may, or the reason they may not with the fix. Links are followed.
export function whyNotRead(
  file: string,
  projectRoot: string
): {reason: string; fix: string} | undefined {
  const written = path.resolve(projectRoot)
  const root = realPath(projectRoot)
  const asked = path.resolve(file)
  const real = realPath(file)
  // No name along the path asked for, or the one it leads to, is private.
  const privateName = [
    ...path.relative(written, asked).split(path.sep),
    ...path.relative(root, real).split(path.sep)
  ].find(isPrivateName)

  if (privateName) {
    return {
      reason: `The path holds ${privateName}, a name the build keeps private.`,
      fix: NO_PRIVATE_NAME
    }
  }

  const inside = path.relative(root, real)

  if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
    return undefined
  }

  // A package is asked for through node_modules, and a package manager may
  // link it from there into the store it keeps at the project or above it.
  if (
    inInstalledModules(asked, [written, root]) &&
    inInstalledModules(real, [root])
  ) {
    return undefined
  }

  // A sibling package of the same workspace is read where it is written.
  const workspace = workspaceRootOf(root)
  const writtenWorkspace = path.resolve(written, path.relative(root, workspace))

  if (
    workspace !== root &&
    inWorkspaceSources(real, workspace) &&
    inWorkspaceSources(asked, writtenWorkspace)
  ) {
    return undefined
  }

  return {
    reason: `The file sits outside the project, at ${toPosixPath(real)}.`,
    fix: KEEP_IN_PROJECT
  }
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

  // A line break ends a string that was never closed, and one after a
  // backslash goes on with it, the two characters of CRLF as one break.
  while (end < css.length && css[end] !== quote && !/[\n\r\f]/.test(css[end])) {
    if (css[end] !== '\\') end++
    else end += css[end + 1] === '\r' && css[end + 2] === '\n' ? 3 : 2
  }

  return Math.min(end + 1, css.length)
}

const IDENT = /[a-z_-][\w-]*/iy
const URL_STRING_FUNCTIONS = new Set([
  'url',
  'src',
  'image-set',
  '-webkit-image-set'
])

// Where an address stands: the string of an @import, the url() of one, any
// other url(), or a string inside src() or image-set(). See the README.
export type CssAddressPlace = 'import' | 'import-url' | 'url' | 'set'

// The sheet with each address `rewrite` answers for replaced, read the way
// CSS reads it. The README says what reaches `rewrite` and what stays.
export function rewriteCssUrls(
  css: string,
  rewrite: (request: string, where: CssAddressPlace) => string | undefined,
  // Writes each new address inside double quotes, whatever it had.
  doubleQuoted = false,
  // An address with an escape in it is passed as written, else skipped.
  escapedToo = false
): string {
  const functions: string[] = []
  let out = ''
  let copied = 0
  let at = 0
  let inImport = false
  // Where the name of the url() being read starts.
  let urlAt = -1

  const put = (
    start: number,
    end: number,
    request: string,
    where: CssAddressPlace,
    quote?: string
  ) => {
    const next =
      request.includes('\\') && !escapedToo
        ? undefined
        : rewrite(request, where)
    if (next === undefined) return

    if (doubleQuoted) {
      const wide = quote ? 1 : 0
      const inUrl = where === 'url' || where === 'import-url'
      // The name is written in lower case, as the one address form.
      const lead = inUrl
        ? `${css.slice(copied, urlAt)}url${css.slice(urlAt + 3, start - wide)}`
        : css.slice(copied, start - wide)

      out += `${lead}"${next.replace(/["\\]/g, '\\$&')}"`
      copied = end + wide

      return
    }

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
        put(
          at + 1,
          end - 1,
          css.slice(at + 1, end - 1),
          named === undefined
            ? 'import'
            : named !== 'url'
              ? 'set'
              : inImport
                ? 'import-url'
                : 'url',
          char
        )
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

        urlAt = at

        while (/\s/.test(css[start] ?? '')) start++

        if (css[start] === '"' || css[start] === "'") {
          functions.push('url')
          at = start
        } else {
          // An unquoted address runs to the closing parenthesis.
          const close = css.indexOf(')', start)
          const end = close === -1 ? css.length : close
          const request = css.slice(start, end).trim()

          if (request) {
            put(
              start,
              start + request.length,
              request,
              inImport ? 'import-url' : 'url'
            )
          }

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

  return rewriteCssUrls(css, (request, where) => {
    if (
      !request ||
      /^[/#~@]/.test(request) ||
      /^[a-z][a-z0-9+.-]*:/i.test(request)
    ) {
      return undefined
    }

    // The string of an @import with no ./ ahead of it is a package.
    if (where === 'import' && !/^\.{1,2}\//.test(request)) return undefined

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
  rule: ImportConditions & {opaque?: string; viaUrl?: boolean}
): string {
  const quote = request.includes('"') ? "'" : '"'
  const target = `${quote}${request}${quote}`
  // Inside url() a name with no ./ ahead of it stays a path.
  const named = rule.viaUrl && /^[^./~@#][^:]*$/.test(request)
  const parts = [`@import ${named ? `url(${target})` : target}`]

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
  answered: Set<string>
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

// The sheet with each @import of a project .css file replaced by its rules.
// `frames` and `chain` hold the conditions and the real files on the way here.
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
    const plain = parsed ? parsed.request.split('?')[0].split('#')[0] : ''
    const named =
      parsed !== undefined &&
      !parsed.request.includes('!') &&
      /^[^./~#][^:]*$/.test(plain)
    const beside = named ? path.resolve(issuerDir, plain) : undefined
    // A name with no ./ ahead of it is a path inside url(), and as a string
    // when a file beside the sheet has exactly that name. Else a package.
    const asPath =
      beside !== undefined &&
      (parsed?.viaUrl === true ||
        (/\.css$/i.test(plain) && isFileNamedExactly(issuerDir, plain)))
    // The one rule for which files a path names.
    const candidates =
      parsed && !parsed.opaque && !parsed.request.includes('!')
        ? beside && asPath
          ? [beside]
          : cssUrlRefFiles(parsed.request, {issuerDir, roots: state.roots})
        : []
    // A private file is no sheet whatever it is called, and is answered
    // for by name the way a sheet in a private folder is.
    const target = candidates.find(
      (candidate) =>
        isFile(candidate) &&
        (/\.css$/i.test(candidate) || isPrivateName(path.basename(candidate)))
    )

    if (!parsed || !target) {
      const written = `${css.slice(start, end).replace(/;$/, '').trim()};`
      const relative =
        parsed !== undefined && (asPath || /^\.{1,2}\//.test(parsed.request))

      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) state.missing.add(candidate)
      }

      // Writing a file by that name beside the sheet changes the answer.
      if (beside && !asPath && /\.css$/i.test(plain)) state.missing.add(beside)

      // Once another sheet's rules come in, an @import that stays would
      // follow a rule, so it leads the result under the conditions it had.
      const conditions =
        parsed && !(parsed.opaque && frames.length > 0)
          ? combineConditions(frames, parsed)
          : frames.length === 0
            ? {}
            : parsed
              ? 'unknown-function'
              : 'no-target'

      if (typeof conditions === 'string') {
        // A package left in a block is for a PostCSS plugin to bring in.
        // An address is for the browser, which skips an @import in a block.
        if (
          !parsed ||
          /^(?:[a-z][a-z0-9+.-]*:|\.{0,2}\/)/i.test(parsed.request)
        ) {
          state.skipped.push({statement: written, file, why: conditions})

          for (const candidate of candidates) state.answered.add(candidate)

          if (!parsed) state.answered.add(leftImportStatement(rule.params))
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
              opaque: parsed.opaque,
              viaUrl: parsed.viaUrl
            })
          : written

      // A list of layer names this import followed goes to the head with it,
      // which a media or supports condition or an unnamed layer rules out.
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
      state.unreadable.push({
        request: parsed.request,
        file: target,
        from: file,
        reason:
          'This stylesheet sets an @namespace, which has to come before every rule, so no imported rules can come in ahead of it.',
        fix: 'Import that file from the script instead, or move the @namespace rules to a sheet of their own.'
      })

      state.answered.add(target)

      return
    }

    const real = realPath(target)

    // A sheet that imports itself, however far down, adds nothing new.
    if (chain.includes(real)) {
      state.cycles.push([...chain.slice(chain.indexOf(real)), real])
      edits.push({start, end, text: ''})

      return
    }

    // A name that stays in a sheet that came in is read from another folder
    // from then on, so it is written as the path it stood for.
    const keepAsPath = () => {
      if (top || target !== beside) return

      edits.push({
        start,
        end,
        text: css
          .slice(start, end)
          .replace(parsed.request, `./${parsed.request}`)
      })
    }

    const refused = whyNotRead(target, state.projectPath)

    if (refused) {
      state.unreadable.push({
        request: parsed.request,
        file: target,
        from: file,
        ...refused
      })

      state.answered.add(target)
      keepAsPath()

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
      state.unreadable.push({
        request: parsed.request,
        file: target,
        from: file,
        ...inner
      })

      state.answered.add(target)
      keepAsPath()

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

// One loop is met from each of its sheets that the first sheet imports, so
// each is told once, from the sheet whose path sorts first.
function uniqueLoops(cycles: string[][]): string[][] {
  const loops = new Map<string, string[]>()

  for (const cycle of cycles) {
    const sheets = cycle.slice(0, -1)
    const first = sheets.indexOf([...sheets].sort()[0])
    const turned = [...sheets.slice(first), ...sheets.slice(0, first)]

    loops.set(turned.join('\0'), [...turned, turned[0]])
  }

  return [...loops.values()]
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
    answered: new Set(),
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
      answered: [],
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
    answered: [...state.answered],
    cycles: uniqueLoops(state.cycles)
  }
}

// How an @import that stays is named, whatever case and spaces it was written
// with, so the run that answers for it and the one that reports it agree.
function leftImportStatement(params: string): string {
  return `@import ${params.trim()};`
}

export interface LeftCssImport {
  statement: string
  request: string
  viaUrl: boolean
}

// Every @import a sheet holds, wherever it stands. None for a sheet that
// does not parse, which has its own word elsewhere.
export function readCssImports(css: string): LeftCssImport[] {
  if (!/@import/i.test(css)) return []

  const found: LeftCssImport[] = []

  try {
    postcss.parse(css).walkAtRules(/^import$/i, (rule) => {
      const parsed = parseImport(rule.params)

      // An import with no target that can be read is left all the same.
      found.push({
        statement: leftImportStatement(rule.params),
        request: parsed?.request ?? '',
        viaUrl: parsed?.viaUrl === true
      })
    })
  } catch {
    return []
  }

  return found
}
