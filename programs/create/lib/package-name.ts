const MAX_LENGTH = 214
const RESERVED = new Set(['node_modules', 'favicon.ico'])
const NOT_ALLOWED = 'it has characters npm does not allow'

function isAllowedChar(char: string) {
  return (
    (char >= 'a' && char <= 'z') ||
    (char >= '0' && char <= '9') ||
    char === '-' ||
    char === '.' ||
    char === '_'
  )
}

function isAllowedPart(part: string) {
  if (part === '' || part.startsWith('.') || part.startsWith('_')) return false

  for (const char of part.toLowerCase()) {
    if (!isAllowedChar(char)) return false
  }

  return true
}

// The first rule the name breaks, or null when npm takes it.
export function npmNameProblem(name: string): string | null {
  if (name === '') return 'it is empty'

  if (name.length > MAX_LENGTH) {
    return `it is longer than ${MAX_LENGTH} characters`
  }

  if (name.trim() !== name) return 'it starts or ends with a space'
  if (name.startsWith('.')) return 'it starts with a dot'
  if (name.startsWith('_')) return 'it starts with an underscore'
  if (RESERVED.has(name)) return 'npm reserves that name'
  if (name.toLowerCase() !== name) return 'it has capital letters'

  if (name.startsWith('@')) {
    const slash = name.indexOf('/')
    const scope = name.slice(1, slash)
    const bare = name.slice(slash + 1)
    const ok = slash > 1 && isAllowedPart(scope) && isAllowedPart(bare)

    return ok ? null : NOT_ALLOWED
  }

  return isAllowedPart(name) ? null : NOT_ALLOWED
}

export type PackageNameAnswer =
  | {name: string; derived: boolean}
  | {reserved: true}

// The name written when nothing the user typed can stand as one by itself.
export const FALLBACK_PACKAGE_NAME = 'my-extension'

function trimDashes(value: string) {
  let start = 0
  let end = value.length

  while (start < end && value[start] === '-') start++
  while (end > start && value[end - 1] === '-') end--

  return value.slice(start, end)
}

// Changes case, turns spaces into dashes and drops punctuation, or answers
// null when a letter or digit npm cannot take would have to go.
function convert(folderName: string): string | null {
  let converted = ''

  for (const char of folderName) {
    const lower = char.toLowerCase()

    if (/\s/.test(char)) {
      if (!converted.endsWith('-')) converted += '-'
    } else if (isAllowedChar(lower)) {
      if (!(lower === '-' && converted.endsWith('-'))) converted += lower
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      return null
    }
  }

  let start = 0
  while (start < converted.length && '._-'.includes(converted[start])) start++

  return trimDashes(converted.slice(start))
}

// The folder keeps what the user typed, in any language. package.json gets
// that name when npm takes it, a cleaned copy when nothing is lost, or the
// fallback. Only a folder name tools claim for themselves is refused.
export function packageNameFor(folderName: string): PackageNameAnswer {
  if (RESERVED.has(folderName.toLowerCase())) return {reserved: true}

  if (npmNameProblem(folderName) === null) {
    return {name: folderName, derived: false}
  }

  const converted = convert(folderName)
  const usable =
    converted !== null && converted !== '' && npmNameProblem(converted) === null

  return {name: usable ? converted : FALLBACK_PACKAGE_NAME, derived: true}
}
