// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

/**
 * Rspack loader that keeps `import(chrome.runtime.getURL(...))` NATIVE.
 *
 * A dynamic import whose argument goes through runtime.getURL receives an
 * absolute chrome-extension:// URL at runtime — the bundler's module map can
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

export function annotateGetURLDynamicImports(source: string): string {
  const insertions: number[] = []
  const n = source.length
  let i = 0
  // Tracks the previous significant (non-space, non-comment) character so a
  // leading `/` can be classified as regex-start vs division — a regex
  // literal's quotes/parens must not desync the scan of code we rewrite.
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
        if (
          args != null &&
          GETURL_ARG.test(args) &&
          !args.includes('webpackIgnore')
        ) {
          insertions.push(j + 1)
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
    out += source.slice(last, at) + '/* webpackIgnore: true */ '
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

/**
 * Return the argument text between an opening paren and its balanced close
 * (string-aware), or null when unbalanced.
 */
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

/**
 * Index of the closing quote, template `${...}` interpolations skipped
 * (they may nest strings and further templates).
 */
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

/** Index of the closing `/` of a regex literal (class- and escape-aware). */
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

/**
 * Classic prev-token heuristic: a `/` starts a regex literal when the
 * previous significant character cannot end an expression.
 */
function regexCanStart(prevSignificant: string): boolean {
  if (!prevSignificant) return true
  return !/[\w$)\]}"'`]/.test(prevSignificant)
}
