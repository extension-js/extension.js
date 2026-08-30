// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

/**
 * Rspack loader that keeps `import(chrome.runtime.getURL(...))` NATIVE.
 *
 * A dynamic import whose argument goes through runtime.getURL receives an
 * absolute chrome-extension:// URL at runtime, the bundler's module map can
 * never contain that key, so lowering the call into the bundler runtime
 * guarantees `Cannot find module 'chrome-extension://<id>/...'` in real
 * Chrome. The target files themselves ship via TraceRuntimeLoadedFiles'
 * getURL pass; the call site just has to stay native so Chrome resolves
 * them. Injecting the `webpackIgnore: true` magic comment inside the parens
 * is the bundler-sanctioned way to opt a single import() out of bundling,
 * and the swc pipeline preserves magic comments (minify stays off at
 * transform time).
 */

const GETURL_ARG = /\bruntime\s*\.\s*getURL\s*\(/

const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/
// `urls.mod` and deeper: the URL is parked on an object rather than a variable.
const MEMBER_PATH = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+$/

const escapeId = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A binding search must read CODE ONLY. Scanning raw text lets a commented-out
// `// const u = getURL(...)` above a real `const u = './local.js'` annotate a
// genuinely local module, which unbundles it and is the inverse of this bug.
function codeOnly(source: string): string {
  let out = ''
  const n = source.length
  let i = 0
  let prevSignificant = ''
  while (i < n) {
    const char = source[i]
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const close = skipString(source, i, n)
      out += source.slice(i, close + 1)
      i = close + 1
      prevSignificant = char
      continue
    }
    if (char === '/' && regexCanStart(prevSignificant)) {
      i = skipRegex(source, i, n) + 1
      prevSignificant = '/'
      continue
    }
    out += char
    if (!/\s/.test(char)) prevSignificant = char
    i++
  }
  return out
}

// The RHS may sit on the next line (a formatter's wrap) and the declaration may
// carry a TS type annotation, so neither a newline nor a `: string` between the
// name and the `=` means the binding is a different one.
const RHS = '[\\s\\S]{0,400}?\\bruntime\\s*\\.\\s*getURL\\s*\\('
const TYPE_ANNOTATION = '(?:\\s*:[^=;\\n]{0,120})?'

function identifierBoundToGetURL(code: string, name: string): boolean {
  const id = escapeId(name)
  const declared = new RegExp(
    '\\b(?:const|let|var)\\s+' + id + TYPE_ANNOTATION + '\\s*=' + RHS
  )
  const assigned = new RegExp('(?:^|[^\\w$.])' + id + '\\s*=(?!=)' + RHS)
  return declared.test(code) || assigned.test(code)
}

// `import(urls.mod)` where the object literal parks the URL on `mod`, or where
// the property is assigned later. Either way the value is still a getURL call.
function memberBoundToGetURL(code: string, path: string): boolean {
  const parts = path.split('.').map((p) => p.trim())
  const leaf = escapeId(parts[parts.length - 1])
  const root = escapeId(parts[0])
  const property = new RegExp(
    '\\b(?:const|let|var)\\s+' +
      root +
      TYPE_ANNOTATION +
      '\\s*=[\\s\\S]{0,400}?\\b' +
      leaf +
      '\\s*:[^,}]{0,200}?\\bruntime\\s*\\.\\s*getURL\\s*\\('
  )
  const assigned = new RegExp(
    '(?:^|[^\\w$])' + escapeId(path.replace(/\s+/g, '')) + '\\s*=(?!=)' + RHS
  )
  return property.test(code) || assigned.test(code.replace(/\s*\.\s*/g, '.'))
}

// `import(u, {with: {type: 'json'}})`: only the first argument is the specifier.
function firstArgument(args: string): string {
  let depth = 0
  for (let i = 0; i < args.length; i++) {
    const char = args[i]
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(args, i, args.length)
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') depth--
    else if (char === ',' && depth === 0) return args.slice(0, i)
  }
  return args
}

export function annotateGetURLDynamicImports(source: string): string {
  const insertions: number[] = []
  const n = source.length
  let i = 0
  // Built once, and only if an import actually needs a binding lookup.
  let cachedCode: string | null = null
  const bindingSource = () => (cachedCode ??= codeOnly(source))
  // Tracks the previous significant (non-space, non-comment) character so a
  // leading `/` can be classified as regex-start vs division.
  let prevSignificant = ''

  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(source, i, n) + 1
      prevSignificant = char
      continue
    }
    if (char === '/' && regexCanStart(prevSignificant)) {
      i = skipRegex(source, i, n) + 1
      prevSignificant = '/'
      continue
    }

    if (
      char === 'i' &&
      source.startsWith('import', i) &&
      !/[\w$.]/.test(source[i - 1] || '') &&
      !/[\w$]/.test(source[i + 6] || '')
    ) {
      let j = i + 6
      while (j < n && /\s/.test(source[j])) j++
      if (source[j] === '(') {
        const args = readBalancedArgs(source, j)
        if (args != null && !args.includes('webpackIgnore')) {
          const specifier = firstArgument(args)
          const direct = GETURL_ARG.test(specifier)
          const name = specifier.trim()
          const code = bindingSource()
          if (
            direct ||
            (BARE_IDENTIFIER.test(name) &&
              identifierBoundToGetURL(code, name)) ||
            (MEMBER_PATH.test(name) && memberBoundToGetURL(code, name))
          ) {
            insertions.push(j + 1)
          }
        }
        // Never step past the args: a nested import( inside them (or a
        // template interpolation holding one) still needs its own visit.
      }
      prevSignificant = 't'
      i += 6
      continue
    }

    if (!/\s/.test(char)) prevSignificant = char
    i++
  }

  if (!insertions.length) return source

  let out = ''
  let last = 0
  for (const at of insertions) {
    out += `${source.slice(last, at)}/* webpackIgnore: true */ `
    last = at
  }
  return out + source.slice(last)
}

/** Loader entry: source-to-source, before the swc transform. */
export default function nativeGetURLImportLoader(
  this: unknown,
  source: string
): string {
  // Fast path: the overwhelming majority of files have no dynamic import
  // or no getURL at all.
  if (!source.includes('import') || !/runtime\s*\.\s*getURL/.test(source)) {
    return source
  }
  return annotateGetURLDynamicImports(source)
}

function readBalancedArgs(code: string, openIndex: number): string | null {
  if (code[openIndex] !== '(') return null
  let depth = 0
  for (let i = openIndex; i < code.length; i++) {
    const char = code[i]
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, code.length)
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

// Index of the closing quote, template interpolations skipped
// (they may nest strings and further templates).
function skipString(code: string, start: number, cap: number): number {
  const quote = code[start]
  for (let i = start + 1; i < cap; i++) {
    if (code[i] === '\\') {
      i++
      continue
    }
    if (code[i] === quote) return i
    if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      for (; j < cap && depth > 0; j++) {
        const char = code[j]
        if (char === '"' || char === "'" || char === '`') {
          j = skipString(code, j, cap)
          continue
        }
        if (char === '{') depth++
        if (char === '}') depth--
      }
      i = j - 1
    }
  }
  return cap
}

function skipRegex(code: string, start: number, cap: number): number {
  let inClass = false
  for (let i = start + 1; i < cap; i++) {
    const char = code[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char === '\n') return i - 1
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) return i
  }
  return cap
}

// Classic prev-token heuristic: a `/` starts a regex literal when the
// previous significant character cannot end an expression.
function regexCanStart(prevSignificant: string): boolean {
  if (!prevSignificant) return true
  return !/[\w$)\]}"'`]/.test(prevSignificant)
}
