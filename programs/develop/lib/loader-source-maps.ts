// ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗      ██████╗  █████╗ ████████╗██╗  ██╗███████╗
// ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║      ██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██╔════╝
// ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║█████╗██████╔╝███████║   ██║   ███████║███████╗
// ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║╚════╝██╔═══╝ ██╔══██║   ██║   ██╔══██║╚════██║
// ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║      ██║     ██║  ██║   ██║   ██║  ██║███████║
// ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Loaders that rewrite a file before swc sees it must hand a map forward, or
// the bundler treats the rewritten text as the source and every emitted map
// points at generated lines. These helpers build the map a text-only loader
// needs: an identity map for the file it received, padded for a prefix and
// trimmed for lines it deleted.

export interface LoaderSourceMap {
  version: 3
  file: string
  sources: string[]
  sourcesContent?: string[]
  names: string[]
  mappings: string
}

// One segment per line: generated column 0 -> source 0, same line, column 0.
// "AACA" is that segment for every line after the first ("AAAA").
export function identityLineMap(
  resourcePath: string,
  source: string
): LoaderSourceMap {
  const lineCount = source.split('\n').length
  const groups: string[] = []
  for (let line = 0; line < lineCount; line++) {
    groups.push(line === 0 ? 'AAAA' : 'AACA')
  }
  return {
    version: 3,
    file: '',
    sources: [resourcePath],
    sourcesContent: [source],
    names: [],
    mappings: groups.join(';')
  }
}

export function isLoaderSourceMap(value: unknown): value is LoaderSourceMap {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as {mappings?: unknown}).mappings === 'string' &&
      Array.isArray((value as {sources?: unknown}).sources)
  )
}

// The map a loader received, or an identity map when it is the first loader.
export function inputOrIdentityMap(
  inputSourceMap: unknown,
  resourcePath: string,
  source: string
): LoaderSourceMap {
  if (isLoaderSourceMap(inputSourceMap)) {
    return {...inputSourceMap, file: inputSourceMap.file || ''}
  }
  if (typeof inputSourceMap === 'string') {
    try {
      const parsed = JSON.parse(inputSourceMap)
      if (isLoaderSourceMap(parsed)) return {...parsed, file: parsed.file || ''}
    } catch {
      // Not a map; fall through to the identity.
    }
  }
  return identityLineMap(resourcePath, source)
}

// A map for `before` becomes a map for `prefix + after`: groups of the
// lines deleted between before and after are dropped at the first
// difference, then the prefix's lines are padded in front.
export function adjustLoaderSourceMap(
  map: LoaderSourceMap,
  options: {prefix?: string; before: string; after: string}
): LoaderSourceMap {
  let groups = map.mappings.split(';')
  const beforeLines = options.before.split('\n')
  const afterLines = options.after.split('\n')
  const removed = beforeLines.length - afterLines.length
  if (removed > 0) {
    let at = 0
    while (
      at < afterLines.length &&
      at < beforeLines.length &&
      beforeLines[at] === afterLines[at]
    ) {
      at++
    }
    groups.splice(at, removed)
  }
  const prefixLineCount = options.prefix
    ? options.prefix.split('\n').length - 1
    : 0
  if (prefixLineCount > 0) {
    groups = [...new Array(prefixLineCount).fill(''), ...groups]
  }
  return {...map, mappings: groups.join(';')}
}

// Hand the text and its map to rspack through this.callback; a context
// without one (a plain call in a unit test) gets the text back as before.
export function returnWithMap(
  context: unknown,
  text: string,
  map: LoaderSourceMap
): string | undefined {
  const callback = (
    context as {
      callback?: (error: Error | null, content: string, map?: unknown) => void
    } | null
  )?.callback
  if (typeof callback === 'function') {
    callback.call(context, null, text, map)
    return undefined
  }
  return text
}
