//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'

// vue-loader asks for each <style> block of a .vue file under this query.
export const SFC_STYLE_BLOCK_QUERY = /(?:^\?|&)vue&type=style(?:&|$)/

export function isSfcStyleBlockQuery(query: string | undefined): boolean {
  return SFC_STYLE_BLOCK_QUERY.test(String(query || ''))
}

// A custom element component (*.ce.vue) imports each block for its text,
// which Vue hands to the element's shadow root.
export const SFC_INLINE_STYLE_BLOCK_QUERY =
  /(?:^\?|&)vue&type=style&(?:[^#]*&)?inline(?:&|$)/

export function isSfcInlineStyleBlockQuery(query: string | undefined): boolean {
  return SFC_INLINE_STYLE_BLOCK_QUERY.test(String(query || ''))
}

// <style module>: the component imports the block for its class names.
export const SFC_MODULE_STYLE_BLOCK_QUERY =
  /(?:^\?|&)vue&type=style&(?:[^#]*&)?module=/

export function isSfcModuleStyleBlockQuery(query: string | undefined): boolean {
  return SFC_MODULE_STYLE_BLOCK_QUERY.test(String(query || ''))
}

interface StyleBlockLoader {
  path?: string
  request?: string
}

// vue-loader refuses a module block wherever native CSS is on. This names
// the request it would have made, as a CSS module the native rules compile.
export function moduleStyleBlockRequest(input: {
  resourcePath: string
  resourceQuery: string
  loaders: StyleBlockLoader[]
  ownPath: string | undefined
}): string | undefined {
  const {resourcePath, resourceQuery, loaders, ownPath} = input
  const pitcher = loaders.find((loader) =>
    /[\\/]vue-loader[\\/]dist[\\/]pitcher\.js$/.test(String(loader.path))
  )
  if (!pitcher?.path) return undefined

  const params = new URLSearchParams(resourceQuery.slice(1))
  const lang = params.get('lang') || 'css'
  const index = params.get('index') || '0'
  const seen = new Set<string>()
  const chain = loaders
    .filter(({path}) => path !== ownPath && path !== pitcher.path)
    .map(({request}) => String(request || ''))
    .filter((request) => {
      if (!request || seen.has(request)) return false

      seen.add(request)

      return true
    })
  const scoping = pitcher.path.slice(0, -'pitcher.js'.length)

  return [
    `${resourcePath}.${index}.module.${lang}!=!-`,
    `${scoping}stylePostLoader.js`,
    ...chain,
    `${resourcePath}${resourceQuery}`
  ].join('!')
}

// svelte-loader names a component's <style> block `Widget.svelte.<n>.css` and
// reads it back from the component, so a CSS loader sees a .svelte resource.
export const SVELTE_STYLE_BLOCK_TEST = /\.svelte\.\d+\.css$/

export function isSvelteStyleBlockPath(
  resourcePath: string | undefined
): boolean {
  return String(resourcePath || '').endsWith('.svelte')
}

export function isSfcStyleBlock(module: {
  resourcePath?: string
  resourceQuery?: string
}): boolean {
  return (
    isSfcStyleBlockQuery(module.resourceQuery) ||
    isSvelteStyleBlockPath(module.resourcePath)
  )
}

// vue-loader answers the first request for a block with one @import line
// naming the request that compiles it. A block's own @import never has `!=!`.
export function readStyleBlockProxyRequest(source: string): string | undefined {
  const match = /^\s*@import\s+("(?:[^"\\]|\\.)*");?\s*$/.exec(source)
  if (!match) return undefined

  try {
    const request = JSON.parse(match[1]) as unknown

    return typeof request === 'string' && request.includes('!=!')
      ? request
      : undefined
  } catch {
    return undefined
  }
}

// One id per block, the same in every build of the same sources. A dev
// build adds its project folder, so two projects open at once never share.
export function sfcStyleBlockId(
  relativePath: string,
  query: string,
  devSalt: string
): string {
  return createHash('sha256')
    .update(`${devSalt}\n${relativePath}\n${query}`)
    .digest('hex')
    .slice(0, 12)
}

// svelte-loader appends the block's source map as a trailing comment. On a
// page that is dead weight, repeated in every document the script runs in.
export function dropSourceMapComment(css: string): string {
  const at = css.lastIndexOf('/*# sourceMappingURL=')
  if (at === -1) return css

  const end = css.indexOf('*/', at)
  if (end === -1 || css.slice(end + 2).trim() !== '') return css

  return `${css.slice(0, at).trimEnd()}\n`
}
