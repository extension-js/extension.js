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
