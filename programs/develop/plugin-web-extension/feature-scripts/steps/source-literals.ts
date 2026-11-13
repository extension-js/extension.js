// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'

// Blank out line and block comments (string-aware) so commented-out calls do
// not produce copies or warnings; contents become spaces to keep offsets.
export function blankComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }

      continue
    }

    if (char === '/' && next === '*') {
      out += '  '
      i += 2

      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }

      if (i < n) {
        out += '  '
        i += 2
      }

      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      // Copy the whole string token verbatim, template interpolations
      // included, so nested backticks cannot desync the comment scan.
      const end = skipString(source, i, n)
      out += source.slice(i, Math.min(end + 1, n))
      i = end + 1
      continue
    }

    out += char
    i++
  }

  return out
}

// Return the argument text up to the matching close paren (string-aware), or
// null when unbalanced. No size cap: minified args can span many kilobytes.
export function readBalancedArgs(
  code: string,
  openIndex: number
): string | null {
  if (code[openIndex] !== '(') return null

  const cap = code.length
  let depth = 0

  for (let i = openIndex; i < cap; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, cap)
      continue
    }

    if (char === '(') depth++

    if (char === ')') {
      depth--
      if (depth === 0) return code.slice(openIndex + 1, i)
    }
  }

  return null
}

// Return the bracketed literal that opens at openIndex, brackets included
// (string-aware), or null when it never closes.
export function readBalancedLiteral(
  code: string,
  openIndex: number
): string | null {
  let depth = 0

  for (let i = openIndex; i < code.length; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, code.length)
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth++

    if (char === ')' || char === ']' || char === '}') {
      depth--
      if (depth === 0) return code.slice(openIndex, i + 1)
    }
  }

  return null
}

// Return the index of the closing quote, skipping template `${...}` blocks;
// without this a nested backtick desyncs every scanner downstream.
export function skipString(code: string, start: number, cap: number): number {
  const quote = code[start]

  for (let i = start + 1; i < cap; i++) {
    if (code[i] === '\\') {
      i++
      continue
    }

    if (code[i] === quote) return i

    if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
      i = skipTemplateExpression(code, i + 2, cap)
    }
  }

  return cap
}

// Given the index just past `${`, return the index of the matching `}` (or
// cap), skipping nested strings, templates, and object literals.
function skipTemplateExpression(
  code: string,
  start: number,
  cap: number
): number {
  let depth = 1

  for (let i = start; i < cap; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, cap)
      continue
    }

    if (char === '{') depth++

    if (char === '}') {
      depth--
      if (depth === 0) return i
    }
  }

  return cap
}

export function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < args.length; i++) {
    const char = args[i]

    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(args, i, args.length)
      current += args.slice(i, end + 1)
      i = end
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--

    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) parts.push(current)

  return parts
}

// Return the string value when the whole argument is a single static string
// literal; null for identifiers, concatenations, and template interpolation.
export function pureStringLiteral(arg: string): string | null {
  const match = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/.exec(arg)
  if (!match) return null
  if (match[1] === '`' && match[2].includes('${')) return null

  return unescapeStringBody(match[2])
}

export function unescapeStringBody(body: string): string {
  return body.replace(/\\(.)/g, '$1')
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A module as a reader that resolves from any file hands it back, so a
// specifier written inside that module can be followed too.
export interface ImportedModule {
  source: string
  file: string
}

// Hands back the module a specifier names, or null when it is not a local
// file this build compiles. The second argument is the importing file.
export type ImportedModuleReader = (
  specifier: string,
  fromFile?: string
) => string | ImportedModule | null

// The literal text a name or a namespace member holds where it is used:
// an array, an object or a string, or null when that cannot be known.
export type LiteralLookup = (
  expression: string,
  useIndex?: number
) => ResolvedLiteral | null

// A literal with the means to read the names written inside it: a lookup
// of the module that holds it, and where in that module it starts.
export interface ResolvedLiteral {
  text: string
  lookup: LiteralLookup
  index: number
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const NAMESPACE_MEMBER = /^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)$/

// Whether the text is a name or a member of one, the two shapes a lookup
// can read a constant through.
export function isConstantReference(text: string): boolean {
  return IDENTIFIER.test(text) || NAMESPACE_MEMBER.test(text)
}

const IMPORT_CLAUSE =
  /(?<![\w$.])import\s+(?!type\b)([^'"`;()]*?)\s*from\s*(['"])([^'"\n]+)\2/g
const LOCAL_DECLARATION =
  /(?<![\w$.])(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
const EXPORTED_DEFAULT = /(?<![\w$.])export\s+default\s*(?=[[{])/g
const EXPORTED_DEFAULT_NAME =
  /(?<![\w$.])export\s+default\s+([A-Za-z_$][\w$]*)[ \t]*(?=;|\r?\n|$)/g
const EXPORT_LIST = /(?<![\w$.])export\s*\{([^}]*)\}(\s*from\s*(?=['"]))?/g
const EXPORT_STAR = /(?<![\w$.])export\s*\*\s*from\s*(?=['"])/g
const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/i
const INITIALIZER = /\s*(?::[^=;\n]*)?=(?![=>])\s*/y
const BARE_DECLARATION = /^[ \t]*(?::[^=;\n]*)?[ \t]*(?:;|\r?\n|$)/
// Words a new line may follow without the next one starting a statement.
const CARRYING_WORDS = new Set([
  'else',
  'do',
  'return',
  'typeof',
  'void',
  'in',
  'of',
  'new',
  'delete',
  'await',
  'yield',
  'case'
])
const ASSIGNMENT = /^\s*=(?![=>])/
const COMPOUND_WRITE =
  /^\s*(?:[-+*/%&|^]=|\*\*=|<<=|>>>?=|&&=|\|\|=|\?\?=|\+\+|--)/
const FUNCTION_HEAD_ARROW = /^\s*(?::[^=;{}()]*)?\s*=>\s*(\{)?/
const FUNCTION_HEAD_BODY = /^\s*(?::[^=;{}()]*)?\s*\{/
// A paren group these words open is a condition, never a parameter list.
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'switch', 'with'])

// A name seen more often than this is not read: it is a minifier's letter,
// and the work to place each sighting would outgrow what it can find.
const MAX_NAME_SIGHTINGS = 400
const MAX_DECLARATOR_SCAN = 20000
// How many modules one lookup may open, and how far a chain may run.
const MAX_MODULE_HOPS = 4
const MAX_MODULE_READS = 32

interface LiteralAt {
  text: string
  index: number
}

// The array or object literal a const of this file holds, when the name is
// declared once in the whole file.
function constLiteralText(code: string, name: string): LiteralAt | null {
  if (!IDENTIFIER.test(name)) return null

  const declarationRe = new RegExp(
    `(?<![\\w$.])const\\s+${escapeRegExp(name)}\\s*(?::[^=;]*)?=\\s*(?=[\\[{])`,
    'g'
  )
  const declarations = [...code.matchAll(declarationRe)]
  if (declarations.length !== 1) return null

  const [declaration] = declarations
  const index = (declaration.index || 0) + declaration[0].length
  const text = readBalancedLiteral(code, index)

  return text == null ? null : {text, index}
}

// Blank out what strings hold, quotes kept, so structure can be read off
// the text without a quoted word or bracket being taken for code.
function maskStrings(code: string): string {
  const parts: string[] = []
  const n = code.length
  let last = 0

  for (let i = 0; i < n; i++) {
    const char = code[i]
    if (char !== '"' && char !== "'" && char !== '`') continue

    const end = skipString(code, i, n)
    parts.push(code.slice(last, i + 1))

    if (end >= n) {
      parts.push(' '.repeat(n - i - 1))
      last = n
      break
    }

    parts.push(' '.repeat(end - i - 1), char)
    last = end + 1
    i = end
  }

  parts.push(code.slice(last))

  return parts.join('')
}

// Every bracket pair of the text, in the order they open, each with the
// pair around it.
interface BracketTable {
  open: number[]
  close: number[]
  parent: number[]
}

function scanBrackets(masked: string): BracketTable {
  const table: BracketTable = {open: [], close: [], parent: []}
  const stack: number[] = []

  for (let i = 0; i < masked.length; i++) {
    const code = masked.charCodeAt(i)

    // ( [ {
    if (code === 40 || code === 91 || code === 123) {
      table.open.push(i)
      table.close.push(masked.length)
      table.parent.push(stack.length > 0 ? stack[stack.length - 1] : -1)
      stack.push(table.open.length - 1)
      continue
    }

    // ) ] }
    if ((code === 41 || code === 93 || code === 125) && stack.length > 0) {
      table.close[stack.pop() as number] = i
    }
  }

  return table
}

// One binding of a name: where it is visible and, when it is a plain
// declaration with a value, where that value starts.
interface Binder {
  start: number
  end: number
  kind: 'const' | 'let' | 'var' | 'other'
  valueAt?: number
  // Where the name is declared, and whether it is declared with no value.
  at: number
  bare?: boolean
}

// One assignment to a name. A plain one that starts a statement can be
// the single value of a name declared without one.
interface Write {
  index: number
  valueAt?: number
  startsStatement?: boolean
}

// The text of one module with the structure a scoped read needs, built
// the first time a name is looked up in it.
class SourceScope {
  private maskedText: string | undefined
  private table: BracketTable | undefined
  private importSpans: Array<[number, number]> | undefined

  constructor(readonly code: string) {}

  get masked(): string {
    this.maskedText ??= maskStrings(this.code)

    return this.maskedText
  }

  private get brackets(): BracketTable {
    this.table ??= scanBrackets(this.masked)

    return this.table
  }

  // The innermost pair around an index, or -1 at the top of the file.
  pairAround(index: number): number {
    const {open, close, parent} = this.brackets
    let low = 0
    let high = open.length - 1
    let pair = -1

    while (low <= high) {
      const middle = (low + high) >> 1

      if (open[middle] < index) {
        pair = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    while (pair !== -1 && close[pair] < index) pair = parent[pair]

    return pair
  }

  pairOpeningAt(index: number): number {
    const {open} = this.brackets
    let low = 0
    let high = open.length - 1

    while (low <= high) {
      const middle = (low + high) >> 1
      if (open[middle] === index) return middle

      if (open[middle] < index) low = middle + 1
      else high = middle - 1
    }

    return -1
  }

  parentOf(pair: number): number {
    return pair === -1 ? -1 : this.brackets.parent[pair]
  }

  openOf(pair: number): number {
    return pair === -1 ? -1 : this.brackets.open[pair]
  }

  closeOf(pair: number): number {
    return pair === -1 ? this.masked.length : this.brackets.close[pair]
  }

  // The block a declaration at this index belongs to.
  blockAround(index: number): [number, number] {
    let pair = this.pairAround(index)

    while (pair !== -1 && this.masked[this.openOf(pair)] !== '{') {
      pair = this.parentOf(pair)
    }

    return [this.openOf(pair), this.closeOf(pair)]
  }

  insideImport(index: number): boolean {
    if (!this.importSpans) {
      this.importSpans = []

      for (const match of this.masked.matchAll(IMPORT_CLAUSE)) {
        const start = match.index || 0
        this.importSpans.push([start, start + match[0].length])
      }
    }

    return this.importSpans.some(
      ([start, end]) => index >= start && index < end
    )
  }

  previousIndex(index: number): number {
    let i = index - 1

    while (i >= 0 && /\s/.test(this.masked[i])) i--

    return i
  }

  // The word that ends right at this index, spaces before it skipped.
  wordEndingAt(index: number): string {
    let end = index

    while (end >= 0 && /\s/.test(this.masked[end])) end--

    let start = end

    while (start >= 0 && /[\w$]/.test(this.masked[start])) start--

    return this.masked.slice(start + 1, end + 1)
  }
}

type Sighting =
  | {type: 'read'}
  | {type: 'import'}
  | {type: 'write'; write: Write}
  | {type: 'binder'; binder: Binder}

function declarationKind(word: string): Binder['kind'] | undefined {
  return word === 'const' || word === 'let' || word === 'var' ? word : undefined
}

// The keyword of the declaration a name after a comma belongs to, as in
// `let a = 1, name = 2`, which is how a minifier writes its constants.
function commaDeclaratorKind(
  scope: SourceScope,
  commaIndex: number
): Binder['kind'] | undefined {
  const {masked} = scope
  const floor = Math.max(0, commaIndex - MAX_DECLARATOR_SCAN)
  let depth = 0

  for (let i = commaIndex - 1; i >= floor; i--) {
    const char = masked[i]

    if (char === ')' || char === ']' || char === '}') {
      depth++
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      if (depth === 0) return undefined

      depth--
      continue
    }

    if (depth !== 0) continue
    if (char === ';') return undefined
    if (char !== 't' && char !== 'r') continue

    // The last letter of const, let or var, read back as a whole word.
    const word = scope.wordEndingAt(i)
    const kind = declarationKind(word)

    if (kind && !/[\w$.]/.test(masked[i - word.length] || '')) return kind
  }

  return undefined
}

// What one sighting of a name is: a read, a write, an import or a binding
// with the stretch of text it is visible in.
function classifySighting(
  scope: SourceScope,
  index: number,
  length: number
): Sighting {
  const {masked} = scope
  if (scope.insideImport(index)) return {type: 'import'}

  const after = masked.slice(index + length, index + length + 240)
  const previous = scope.previousIndex(index)
  const previousChar = previous >= 0 ? masked[previous] : ''
  const previousWord = /[\w$]/.test(previousChar)
    ? scope.wordEndingAt(previous)
    : ''
  const kind = declarationKind(previousWord)
  const [blockStart, blockEnd] = scope.blockAround(index)

  if (kind) {
    INITIALIZER.lastIndex = index + length
    const initializer = INITIALIZER.exec(masked)

    return {
      type: 'binder',
      binder: {
        start: blockStart,
        end: blockEnd,
        kind,
        at: index,
        valueAt: initializer ? INITIALIZER.lastIndex : undefined,
        bare: !initializer && kind !== 'const' && BARE_DECLARATION.test(after)
      }
    }
  }

  if (
    previousWord === 'function' ||
    previousWord === 'class' ||
    (previousChar === '*' &&
      scope.wordEndingAt(scope.previousIndex(previous)) === 'function')
  ) {
    return {
      type: 'binder',
      binder: {start: blockStart, end: blockEnd, kind: 'other', at: index}
    }
  }

  const around = scope.pairAround(index)
  const aroundChar = around === -1 ? '' : masked[scope.openOf(around)]

  // A key of an object literal names a property, not this binding.
  if (
    /^\s*:/.test(after) &&
    aroundChar === '{' &&
    (previousChar === '{' || previousChar === ',')
  ) {
    return {type: 'read'}
  }

  // The parameter of an arrow function written without parens.
  const arrow = /^\s*=>\s*(\{)?/.exec(after)

  if (arrow) {
    const body = arrow[1]
      ? scope.pairOpeningAt(index + length + arrow[0].length - 1)
      : around

    return {
      type: 'binder',
      binder: {
        start: scope.openOf(body),
        end: scope.closeOf(body),
        kind: 'other',
        at: index
      }
    }
  }

  // Up through a destructuring pattern to the parens that may hold it.
  let group = around

  for (let hops = 0; group !== -1 && hops < 4; hops++) {
    const open = scope.openOf(group)
    if (masked[open] === '(') break

    if (declarationKind(scope.wordEndingAt(open - 1))) {
      const [start, end] = scope.blockAround(open)

      return {type: 'binder', binder: {start, end, kind: 'other', at: index}}
    }

    if (ASSIGNMENT.test(masked.slice(scope.closeOf(group) + 1))) {
      return {type: 'write', write: {index}}
    }

    group = scope.parentOf(group)
  }

  if (group !== -1 && masked[scope.openOf(group)] === '(') {
    const open = scope.openOf(group)
    const close = scope.closeOf(group)
    const head = masked.slice(close + 1, close + 241)
    const arrowHead = FUNCTION_HEAD_ARROW.exec(head)

    if (arrowHead) {
      const outer = scope.parentOf(group)
      const body = arrowHead[1]
        ? scope.pairOpeningAt(close + arrowHead[0].length)
        : outer

      return {
        type: 'binder',
        binder: {
          start: scope.openOf(body),
          end: scope.closeOf(body),
          kind: 'other',
          at: index
        }
      }
    }

    const bodyHead = FUNCTION_HEAD_BODY.exec(head)

    if (bodyHead && !CONTROL_WORDS.has(scope.wordEndingAt(open - 1))) {
      const body = scope.pairOpeningAt(close + bodyHead[0].length)

      return {
        type: 'binder',
        binder: {
          start: scope.openOf(body),
          end: scope.closeOf(body),
          kind: 'other',
          at: index
        }
      }
    }
  }

  if (ASSIGNMENT.test(after)) {
    const declaredAs =
      previousChar === ',' ? commaDeclaratorKind(scope, previous) : undefined

    INITIALIZER.lastIndex = index + length
    INITIALIZER.exec(masked)
    const valueAt = INITIALIZER.lastIndex

    if (!declaredAs) {
      const gap = masked.slice(previous + 1, index)
      const startsStatement =
        previous < 0 ||
        ';{}'.includes(previousChar) ||
        (/[\r\n]/.test(gap) &&
          /[\w$'"`\])]/.test(previousChar) &&
          !CARRYING_WORDS.has(previousWord))

      return {type: 'write', write: {index, valueAt, startsStatement}}
    }

    return {
      type: 'binder',
      binder: {
        start: blockStart,
        end: blockEnd,
        kind: declaredAs,
        at: index,
        valueAt
      }
    }
  }

  if (
    COMPOUND_WRITE.test(after) ||
    /(?:\+\+|--)\s*$/.test(masked.slice(Math.max(0, index - 8), index))
  ) {
    return {type: 'write', write: {index}}
  }

  return {type: 'read'}
}

// The literal a declaration starts with, or null when the value is not a
// literal alone: a call on it or an operator after it makes another value.
function readInitializer(code: string, index: number): string | null {
  const char = code[index]
  let text: string | null = null

  if (char === '[' || char === '{') {
    text = readBalancedLiteral(code, index)
  } else if (char === '"' || char === "'" || char === '`') {
    const close = skipString(code, index, code.length)
    if (close >= code.length) return null

    text = code.slice(index, close + 1)
    if (pureStringLiteral(text) == null) return null
  }

  if (text == null) return null

  const rest = /^(\s*)(as\b|satisfies\b|[\s\S])?/.exec(
    code.slice(index + text.length, index + text.length + 80)
  )
  const [, gap = '', next] = rest || []

  if (next === undefined || next.length > 1 || ';,)]}'.includes(next)) {
    return text
  }

  // A new line ends the value unless the next one carries it on.
  return /[\r\n]/.test(gap) && !'.+-*/%&|<>=!?([`'.includes(next) ? text : null
}

interface Sightings {
  binders: Binder[]
  writes: Write[]
  imported: boolean
}

// Every place the file binds, writes or imports a name, or null when the
// name is seen too often to place.
function collectSightings(scope: SourceScope, name: string): Sightings | null {
  const nameRe = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, 'g')
  const {masked} = scope
  const seen: Sightings = {binders: [], writes: [], imported: false}
  let count = 0
  let match: RegExpExecArray | null

  while ((match = nameRe.exec(masked))) {
    const index = match.index

    // A property of something else, a spread or rest aside.
    if (masked[index - 1] === '.' && masked.slice(index - 3, index) !== '...') {
      continue
    }

    if (++count > MAX_NAME_SIGHTINGS) return null

    const sighting = classifySighting(scope, index, name.length)

    if (sighting.type === 'import') seen.imported = true
    if (sighting.type === 'write') seen.writes.push(sighting.write)
    if (sighting.type === 'binder') seen.binders.push(sighting.binder)
  }

  return seen
}

// The value of the nearest declaration around the place a name is used.
// Undefined when the file declares no such name, null when it is unknown.
function scopedLiteralText(
  scope: SourceScope,
  name: string,
  useIndex: number | undefined
): LiteralAt | null | undefined {
  const seen = collectSightings(scope, name)
  // A name seen too often is left to the import rule, as it always was.
  if (!seen) return undefined

  const {binders, writes, imported} = seen

  // An imported name is read by the import rule, which also weighs the
  // declarations beside it.
  if (imported || binders.length === 0) return undefined

  if (binders.length > 1 && binders.some((binder) => binder.kind === 'var')) {
    return null
  }

  const visible =
    useIndex === undefined
      ? binders
      : binders.filter(
          (binder) => binder.start < useIndex && useIndex < binder.end
        )
  if (visible.length === 0) return null

  const span = (binder: Binder) => binder.end - binder.start
  const nearest = visible.reduce((best, binder) =>
    span(binder) < span(best) ? binder : best
  )
  const rivals = visible.filter((binder) => span(binder) === span(nearest))
  if (rivals.length !== 1) return null

  const written = writes.filter(
    (write) => write.index > nearest.start && write.index < nearest.end
  )
  let valueAt = nearest.valueAt

  if (valueAt === undefined) {
    // Declared with no value: the one plain assignment beside it, at the
    // same level and before the place the name is used, is its value.
    const [write] = written

    if (!nearest.bare || written.length !== 1 || useIndex === undefined) {
      return null
    }

    const [start, end] = scope.blockAround(write.index)

    if (
      !write.startsStatement ||
      write.valueAt === undefined ||
      write.index < nearest.at ||
      write.index >= useIndex ||
      start !== nearest.start ||
      end !== nearest.end
    ) {
      return null
    }

    valueAt = write.valueAt
  } else if (nearest.kind !== 'const' && written.length > 0) {
    return null
  }

  const text = readInitializer(scope.code, valueAt)

  return text == null ? null : {text, index: valueAt}
}

// Whether the file declares the name itself, which leaves an import of
// the same name alone, since no scope is read for it.
function declaresLocally(code: string, name: string): boolean {
  for (const declaration of code.matchAll(LOCAL_DECLARATION)) {
    if (declaration[1] === name) return true
  }

  return false
}

interface ImportBinding {
  specifier: string
  exportName: string
}

// Where a name of this file is imported from and what it is called there.
function importedBinding(code: string, name: string): ImportBinding | null {
  if (declaresLocally(code, name)) return null

  const found: ImportBinding[] = []

  for (const [, clause, , specifier] of code.matchAll(IMPORT_CLAUSE)) {
    const open = clause.indexOf('{')
    const close = clause.lastIndexOf('}')
    const named = open !== -1 && close > open
    const defaultName = (named ? clause.slice(0, open) : clause)
      .replace(/,\s*$/, '')
      .trim()

    if (defaultName === name) found.push({specifier, exportName: 'default'})
    if (!named) continue

    for (const part of clause.slice(open + 1, close).split(',')) {
      const [exportName, localName = exportName] = part.trim().split(/\s+as\s+/)

      if (localName === name && IDENTIFIER.test(exportName)) {
        found.push({specifier, exportName})
      }
    }
  }

  return found.length === 1 ? found[0] : null
}

// The module a namespace import of this file names, as `import * as ns`.
function importedNamespace(code: string, name: string): string | null {
  if (declaresLocally(code, name)) return null

  const found: string[] = []

  for (const [, clause, , specifier] of code.matchAll(IMPORT_CLAUSE)) {
    const namespace = /(?:^|,)\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*$/.exec(clause)
    if (namespace?.[1] === name) found.push(specifier)
  }

  return found.length === 1 ? found[0] : null
}

// One module a constant is read from, with the way to open the modules
// its own specifiers name, when there is one.
interface ModuleRef {
  scope: SourceScope
  open?: (specifier: string) => ModuleRef | null
}

const isRelative = (specifier: string) => /^\.\.?\//.test(specifier)

function joinSpecifier(base: string, specifier: string): string {
  const joined = path.posix.join(base, specifier)

  return joined.startsWith('.') ? joined : `./${joined}`
}

// Opens modules for one lookup, counting them so a wide or circular graph
// of exports ends.
class ModuleOpener {
  private reads = 0

  constructor(private readonly readImported: ImportedModuleReader) {}

  // A module named by a specifier the entry file wrote.
  fromEntry(specifier: string): ModuleRef | null {
    return this.wrap(this.read(specifier), specifier)
  }

  private read(
    specifier: string,
    fromFile?: string
  ): string | ImportedModule | null {
    if (++this.reads > MAX_MODULE_READS) return null

    try {
      return this.readImported(specifier, fromFile) ?? null
    } catch {
      return null
    }
  }

  private wrap(
    module: string | ImportedModule | null,
    entrySpecifier: string
  ): ModuleRef | null {
    if (module == null) return null

    if (typeof module !== 'string') {
      const {file, source} = module
      if (typeof source !== 'string' || typeof file !== 'string') return null

      return {
        scope: new SourceScope(blankComments(source)),
        open: (specifier) => this.wrap(this.read(specifier, file), specifier)
      }
    }

    return {
      scope: new SourceScope(blankComments(module)),
      open: (specifier) => this.openBeside(entrySpecifier, specifier)
    }
  }

  // A reader of text alone resolves from the entry file, so the specifier
  // is respelled from there, as beside a file and as under a folder index.
  private openBeside(base: string, specifier: string): ModuleRef | null {
    if (!isRelative(base) || !isRelative(specifier)) return null

    const candidates = [joinSpecifier(path.posix.dirname(base), specifier)]

    if (!SCRIPT_EXTENSION.test(base) && !/(?:^|\/)index$/.test(base)) {
      candidates.push(joinSpecifier(base, specifier))
    }

    const opened: Array<{text: string; ref: ModuleRef}> = []

    for (const candidate of new Set(candidates)) {
      const module = this.read(candidate)
      const ref = this.wrap(module, candidate)
      if (!ref || module == null) continue

      const text = typeof module === 'string' ? module : module.source

      if (!opened.some((other) => other.text === text)) {
        opened.push({text, ref})
      }
    }

    return opened.length === 1 ? opened[0].ref : null
  }
}

function specifierAt(code: string, quoteIndex: number): string | null {
  const close = skipString(code, quoteIndex, code.length)
  if (close >= code.length) return null

  return pureStringLiteral(code.slice(quoteIndex, close + 1))
}

// A literal with the module that holds it, so the names inside it can be
// read where they are declared.
interface FoundLiteral extends LiteralAt {
  module: ModuleRef
}

// The literal a name of this module holds, declared here or imported.
// Scoped only: the once-declared const rule, which reads no scope, is off.
function moduleLiteral(
  module: ModuleRef,
  name: string,
  useIndex: number | undefined,
  hops: number,
  scopedOnly = false
): FoundLiteral | null {
  const {code} = module.scope
  const local = scopedOnly ? null : constLiteralText(code, name)
  if (local != null) return {...local, module}

  const scoped = scopedLiteralText(module.scope, name, useIndex)
  if (scoped !== undefined) return scoped && {...scoped, module}
  if (!module.open) return null

  const binding = importedBinding(code, name)
  if (!binding) return null

  const imported = module.open(binding.specifier)

  return imported
    ? exportedLiteral(imported, binding.exportName, hops + 1)
    : null
}

// The literal a module exports under a name: declared with the export,
// listed in an export statement, or passed on from another module.
function exportedLiteral(
  module: ModuleRef,
  exportName: string,
  hops: number
): FoundLiteral | null {
  if (hops > MAX_MODULE_HOPS || !IDENTIFIER.test(exportName)) return null

  const {code, masked} = module.scope

  if (exportName === 'default') {
    const defaults = [...code.matchAll(EXPORTED_DEFAULT)]

    if (defaults.length === 1) {
      const [declaration] = defaults
      const index = (declaration.index || 0) + declaration[0].length
      const text = readBalancedLiteral(code, index)

      return text == null ? null : {text, index, module}
    }

    // A default that is a name is read as that name, where it is exported.
    const named = [...masked.matchAll(EXPORTED_DEFAULT_NAME)]
    if (named.length > 1) return null

    if (named.length === 1) {
      return moduleLiteral(module, named[0][1], named[0].index, hops)
    }
  } else {
    const declaredRe = new RegExp(
      `(?<![\\w$.])export\\s+(?:const|let|var)\\s+${escapeRegExp(exportName)}(?![\\w$])`,
      'g'
    )
    const declared = [...masked.matchAll(declaredRe)]
    if (declared.length > 1) return null

    if (declared.length === 1) {
      return moduleLiteral(module, exportName, declared[0].index, hops)
    }
  }

  for (const list of masked.matchAll(EXPORT_LIST)) {
    const start = list.index || 0

    for (const part of list[1].split(',')) {
      const [localName, exportedAs = localName] = part.trim().split(/\s+as\s+/)
      if (exportedAs !== exportName || !IDENTIFIER.test(localName)) continue

      if (!list[2]) return moduleLiteral(module, localName, start, hops)

      const specifier = specifierAt(code, start + list[0].length)
      const passedOn = specifier ? module.open?.(specifier) : null

      return passedOn ? exportedLiteral(passedOn, localName, hops + 1) : null
    }
  }

  // Export star never passes a default on, and two that hold the name
  // with different values leave no single answer.
  if (exportName === 'default') return null

  const starred = new Map<string, FoundLiteral>()

  for (const star of masked.matchAll(EXPORT_STAR)) {
    const specifier = specifierAt(code, (star.index || 0) + star[0].length)
    const passedOn = specifier ? module.open?.(specifier) : null
    const literal = passedOn
      ? exportedLiteral(passedOn, exportName, hops + 1)
      : null

    if (literal != null && !starred.has(literal.text)) {
      starred.set(literal.text, literal)
    }
  }

  return starred.size === 1 ? [...starred.values()][0] : null
}

// Reads a name or a namespace member in one module. The module is made
// anew for each read, so each gets its own budget of modules to open.
function lookupIn(enter: () => ModuleRef, scopedOnly = false): LiteralLookup {
  return (expression, useIndex) => {
    const text = expression.trim()

    try {
      const module = enter()
      let found: FoundLiteral | null = null

      if (IDENTIFIER.test(text)) {
        found = moduleLiteral(module, text, useIndex, 0, scopedOnly)
      } else {
        const member = NAMESPACE_MEMBER.exec(text)
        if (!member || !module.open) return null

        const specifier = importedNamespace(module.scope.code, member[1])
        if (!specifier) return null

        // A parameter or a pattern of the same name hides the namespace.
        const seen = collectSightings(module.scope, member[1])
        if (!seen || seen.binders.length > 0) return null

        const namespace = module.open(specifier)
        found = namespace ? exportedLiteral(namespace, member[2], 1) : null
      }

      if (!found) return null

      const holder = found.module

      return {
        text: found.text,
        index: found.index,
        // A name inside a literal is new ground, read by its scope alone.
        lookup: lookupIn(() => holder, true)
      }
    } catch {
      // Text no rule above expects is a value that cannot be known.
      return null
    }
  }
}

// A constant is read where it is declared: in this file by the scope it
// is used in, or in the module that exports it, a few imports away.
export function literalLookup(
  code: string,
  readImported?: ImportedModuleReader
): LiteralLookup {
  const scope = new SourceScope(code)

  return lookupIn(() => {
    const opener = readImported && new ModuleOpener(readImported)

    return {
      scope,
      open: opener
        ? (specifier: string) => opener.fromEntry(specifier)
        : undefined
    }
  })
}
