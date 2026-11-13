// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  blankComments,
  declaredValueIndex,
  type ImportedModuleReader,
  isConstantReference,
  type LiteralLookup,
  literalLookup,
  pureStringLiteral,
  readBalancedArgs,
  readBalancedLiteral,
  splitTopLevelArgs
} from '../steps/source-literals'
import {
  constantStrings,
  groupPropEntries,
  type RegisteredScriptGroup,
  splitRegisteredScriptGroups,
  splitTopLevelConditional,
  stringElements
} from '../steps/trace-runtime-loaded-files'

// The world a scripting call runs a file in, as far as the source says.
export type RegisteredWorld = 'MAIN' | 'ISOLATED' | 'UNKNOWN'

export interface RegisteredFileSighting {
  file: string
  world: RegisteredWorld
  // Where the call starts in the source it was read from.
  index: number
  // True for a registration, which the browser keeps under the path it was
  // given. An injection runs once and leaves no path behind.
  kept: boolean
}

interface Home {
  lookup: LiteralLookup
  at: number
}

// The element a mapped list hands its callback, under the name it is given.
interface Binding {
  param: string
  value: string
}

interface Member {
  text: string
  home: Home
  binding?: Binding
  // How many spreads of an unknown value came before this member.
  open: number
}

interface Props {
  values: Map<string, Member>
  open: number
}

interface GroupReading {
  files: string[]
  worlds: RegisteredWorld[]
}

const MAX_DEPTH = 4
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const KEYED_MEMBER =
  /^(?:(["'])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*:(?!:)\s*([\s\S]+)$/
const TYPE_CAST = /\s+(?:as|satisfies)\s+[\w$.<>[\]'"| ]+$/
const MAIN_LITERAL = /["']?world["']?\s*:\s*(['"])MAIN\1/
const WORLD_VALUE = /(?<![\w$.])["']?world["']?\s*:\s*([^,}\r\n]*)/g
const WORLD_SHORTHAND = /[{,]\s*world\s*(?=[,}])/
const ARROW_CALLBACK =
  /^(?:\(\s*([A-Za-z_$][\w$]*)\s*(?::[^,)]*)?(?:,[^)]*)?\)|([A-Za-z_$][\w$]*))\s*(?::[^=]*)?=>\s*([\s\S]+)$/
const FUNCTION_CALLBACK =
  /^function\s*[\w$]*\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*(?::[^{]*)?(\{[\s\S]*\})$/
const RETURNED_VALUE = /^\{\s*return\s+([\s\S]+?)\s*;?\s*\}$/
const MAPPED_LIST_HEAD =
  /^[A-Za-z_$][\w$]*(?:\s*\.\s*(?!map\s*\()[A-Za-z_$][\w$]*)?/
const MAP_CALL = /^\s*\.\s*map\s*\(/
const STATEMENT_END = /^[ \t]*(?:;|\r?\n|$)/

const worldOf = (value: string): RegisteredWorld =>
  value === 'MAIN' ? 'MAIN' : 'ISOLATED'

// The expression without the parens around it or the type it is cast to.
function bare(text: string): string {
  let current = text.trim()

  for (let i = 0; i < MAX_DEPTH; i++) {
    const cast = current.replace(TYPE_CAST, '').trim()
    const unwrapped =
      cast.startsWith('(') && readBalancedArgs(cast, 0) === cast.slice(1, -1)
        ? cast.slice(1, -1).trim()
        : cast

    if (unwrapped === current) break

    current = unwrapped
  }

  return current
}

function objectMembers(text: string): string[] | null {
  const trimmed = text.trim()

  if (!trimmed.startsWith('{') || readBalancedLiteral(trimmed, 0) !== trimmed) {
    return null
  }

  return splitTopLevelArgs(trimmed.slice(1, -1))
    .map((member) => member.trim())
    .filter(Boolean)
}

// The properties of an object literal in order, a spread of a literal or of
// a constant read in place. False when the text is no object literal.
function readProps(
  text: string,
  home: Home,
  binding: Binding | undefined,
  props: Props,
  depth = 0
): boolean {
  const members = objectMembers(text)
  if (!members) return false

  for (const member of members) {
    if (member.startsWith('...')) {
      const spread = bare(member.slice(3))
      let merged = false

      if (depth < MAX_DEPTH && spread.startsWith('{')) {
        merged = readProps(spread, home, binding, props, depth + 1)
      } else if (depth < MAX_DEPTH && isConstantReference(spread)) {
        const found = home.lookup(spread, home.at)

        // A name inside a constant belongs to where the constant is written.
        merged =
          !!found &&
          readProps(
            found.text,
            {lookup: found.lookup, at: found.index},
            undefined,
            props,
            depth + 1
          )
      }

      // Whatever this spread carries may set any property.
      if (!merged) props.open++

      continue
    }

    const keyed = KEYED_MEMBER.exec(member)

    if (keyed) {
      props.values.set(keyed[2] || keyed[3], {
        text: keyed[4],
        home,
        binding,
        open: props.open
      })
    } else if (IDENTIFIER.test(member)) {
      props.values.set(member, {text: member, home, binding, open: props.open})
    } else if (member.startsWith('[')) {
      // A computed key may be any property.
      props.open++
    }
  }

  return true
}

function worldsOfValue(
  member: Member,
  text: string,
  depth = 0
): RegisteredWorld[] {
  const value = bare(text)
  const literal = pureStringLiteral(value)
  if (literal != null) return [worldOf(literal)]

  if (member.binding && value === member.binding.param) {
    return [worldOf(member.binding.value)]
  }

  if (isConstantReference(value)) {
    const found = member.home.lookup(value, member.home.at)
    const held = found ? pureStringLiteral(found.text) : null

    return held == null ? ['UNKNOWN'] : [worldOf(held)]
  }

  const branches = depth < MAX_DEPTH ? splitTopLevelConditional(value) : null
  if (!branches) return ['UNKNOWN']

  return [
    ...worldsOfValue(member, branches[0], depth + 1),
    ...worldsOfValue(member, branches[1], depth + 1)
  ]
}

function worldsOfProps(props: Props): RegisteredWorld[] {
  const world = props.values.get('world')

  // A later spread of an unknown value may have set the world again.
  if (!world) return props.open > 0 ? ['UNKNOWN'] : ['ISOLATED']
  if (world.open !== props.open) return ['UNKNOWN']

  return [...new Set(worldsOfValue(world, world.text))]
}

function filesOfProps(props: Props, prop: string): string[] {
  const member = props.values.get(prop)
  if (!member) return []

  const text = bare(member.text)
  const {home, binding} = member

  if (text.startsWith('[') && readBalancedLiteral(text, 0) === text) {
    const files: string[] = []

    for (const element of splitTopLevelArgs(text.slice(1, -1))) {
      const literal = pureStringLiteral(element)

      if (literal != null) files.push(literal)
      else if (binding && element.trim() === binding.param) {
        files.push(binding.value)
      } else {
        files.push(...(constantStrings(home.lookup, element, home.at) ?? []))
      }
    }

    return files
  }

  if (!isConstantReference(text) || text === binding?.param) return []

  const found = home.lookup(text, home.at)

  return (found && stringElements(found, false)) || []
}

// What the text of a call says when it is no object the rules above read:
// a MAIN literal anywhere names the page's world, as it always did.
function readLoosely(group: RegisteredScriptGroup, prop: string): GroupReading {
  const files = groupPropEntries(group, prop).map((entry) => entry.value)

  if (MAIN_LITERAL.test(group.text)) return {files, worlds: ['MAIN']}

  const unread =
    WORLD_SHORTHAND.test(group.text) ||
    [...group.text.matchAll(WORLD_VALUE)].some(
      (match) => pureStringLiteral(bare(match[1])) == null
    )

  return {files, worlds: [unread ? 'UNKNOWN' : 'ISOLATED']}
}

function readObject(
  group: RegisteredScriptGroup,
  text: string,
  prop: string,
  binding?: Binding
): GroupReading | null {
  const props: Props = {values: new Map(), open: 0}
  const home = {lookup: group.lookup, at: group.at}
  if (!readProps(text, home, binding, props)) return null

  return {
    files: [
      ...new Set([
        ...filesOfProps(props, prop),
        ...groupPropEntries({...group, text}, prop).map((entry) => entry.value)
      ])
    ],
    worlds: worldsOfProps(props)
  }
}

interface MappedList {
  list: string
  param: string
  body: string
}

// The object a callback returns for each element, when that is all it does.
function parseCallback(args: string): Omit<MappedList, 'list'> | null {
  const parts = splitTopLevelArgs(args)
  if (parts.length !== 1) return null

  const callback = parts[0].trim()
  const arrow = ARROW_CALLBACK.exec(callback)
  const classic = arrow ? null : FUNCTION_CALLBACK.exec(callback)
  const param = arrow ? arrow[1] || arrow[2] : classic?.[1]
  const rest = (arrow ? arrow[3] : classic?.[2])?.trim()
  if (!param || !rest) return null

  // A callback that opens on a brace opens a block, never an object.
  const returned = rest.startsWith('{') ? RETURNED_VALUE.exec(rest)?.[1] : rest
  if (!returned) return null

  const body = bare(returned)

  return objectMembers(body) ? {param, body} : null
}

// `list.map(callback)` with nothing after it, or null for any other text.
function parseMappedList(text: string): MappedList | null {
  const trimmed = text.trim()
  if (!trimmed.endsWith(')')) return null

  const mapRe = /\.\s*map\s*\(/g
  let match: RegExpExecArray | null

  while ((match = mapRe.exec(trimmed))) {
    const open = match.index + match[0].length - 1
    const args = readBalancedArgs(trimmed, open)
    if (args == null || open + args.length + 2 !== trimmed.length) continue

    const callback = parseCallback(args)

    return callback ? {list: trimmed.slice(0, match.index), ...callback} : null
  }

  return null
}

// The strings of the list a map runs over, written in place or held in a
// constant. Null when one element is not a string that can be read.
function listValues(list: string, home: Home): string[] | null {
  const text = bare(list)

  if (text.startsWith('[') && readBalancedLiteral(text, 0) === text) {
    return stringElements({text, lookup: home.lookup, index: home.at}, true)
  }

  if (!isConstantReference(text)) return null

  const found = home.lookup(text, home.at)

  return found ? stringElements(found, true) : null
}

function readGroup(group: RegisteredScriptGroup, prop: string): GroupReading[] {
  const trimmed = group.text.trim()
  const text = trimmed.startsWith('...') ? trimmed.slice(3).trim() : trimmed
  const mapped = parseMappedList(text)
  const values =
    mapped && listValues(mapped.list, {lookup: group.lookup, at: group.at})

  if (mapped && values) {
    const readings: GroupReading[] = []

    for (const value of values) {
      const reading = readObject(group, mapped.body, prop, {
        param: mapped.param,
        value
      })
      if (!reading) return [readLoosely(group, prop)]

      readings.push(reading)
    }

    return readings
  }

  return [readObject(group, text, prop) ?? readLoosely(group, prop)]
}

// A mapped list held in a constant and passed by name. The list is read
// where the constant is declared, by the scope the call names it from.
function mappedConstantGroups(
  code: string,
  lookup: LiteralLookup,
  args: string,
  useIndex: number
): RegisteredScriptGroup[] {
  const [first] = splitTopLevelArgs(args)
  const name = first?.trim() || ''
  if (!IDENTIFIER.test(name)) return []

  const valueAt = declaredValueIndex(code, name, useIndex)
  if (valueAt == null) return []

  let cursor = valueAt

  if (code[cursor] === '[') {
    const literal = readBalancedLiteral(code, cursor)
    if (literal == null) return []

    cursor += literal.length
  } else {
    const head = MAPPED_LIST_HEAD.exec(code.slice(cursor, cursor + 200))
    if (!head) return []

    cursor += head[0].length
  }

  const call = MAP_CALL.exec(code.slice(cursor, cursor + 40))
  if (!call) return []

  const open = cursor + call[0].length - 1
  const mapArgs = readBalancedArgs(code, open)
  if (mapArgs == null) return []

  const end = open + mapArgs.length + 2
  // A call chained after the map makes another list.
  if (!STATEMENT_END.test(code.slice(end, end + 40))) return []

  return [
    {text: code.slice(valueAt, end), viaConstant: true, lookup, at: valueAt}
  ]
}

// Every file a registerContentScripts, updateContentScripts or executeScript
// call names, with the world the call gives it. One entry per file and world.
export function extractRegisteredFileSightings(
  source: string,
  readImported?: ImportedModuleReader
): RegisteredFileSighting[] {
  const code = blankComments(source)
  const lookup = literalLookup(code, readImported)
  const sightings: RegisteredFileSighting[] = []
  const calls = [
    {
      callRe: /\b(?:registerContentScripts|updateContentScripts)\s*\(/g,
      arrayProp: 'js'
    },
    {callRe: /\bexecuteScript\s*\(/g, arrayProp: 'files'}
  ]

  for (const {callRe, arrayProp} of calls) {
    let match: RegExpExecArray | null

    while ((match = callRe.exec(code))) {
      const index = match.index
      const args = readBalancedArgs(code, index + match[0].length - 1)
      if (args == null) continue

      try {
        const first = splitTopLevelArgs(args)[0]?.trim() || ''
        // A list with a call after it is one value, not a list of groups.
        const called =
          first.startsWith('[') && readBalancedLiteral(first, 0) !== first
        const split = called
          ? [{text: first, viaConstant: false, lookup, at: index}]
          : splitRegisteredScriptGroups(lookup, args, index)
        const groups =
          split.length > 0
            ? split
            : mappedConstantGroups(code, lookup, args, index)

        for (const group of groups) {
          for (const {files, worlds} of readGroup(group, arrayProp)) {
            for (const file of files) {
              for (const world of worlds) {
                sightings.push({file, world, index, kept: arrayProp === 'js'})
              }
            }
          }
        }
      } catch {
        // Text no rule above expects names nothing, as it always did.
      }
    }
  }

  return sightings
}

// Extract the js files a runtime registration or injection asks the browser to
// run in the page's own world. The world rides the same object as the files.
export function extractMainWorldRegisteredFileLiterals(
  source: string,
  readImported?: ImportedModuleReader
): string[] {
  return extractRegisteredFileSightings(source, readImported)
    .filter((sighting) => sighting.world === 'MAIN')
    .map((sighting) => sighting.file)
}
