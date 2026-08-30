// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type * as parse5utilities from 'parse5-utilities'
import {cleanAssetUrl} from './utils'

interface HtmlAttribute {
  name: string
  value: string
}

interface HtmlNode {
  nodeName: string
  attrs: HtmlAttribute[]
  childNodes: HtmlNode[]
  value?: string
  data?: string
}

function isUrl(src: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(src)
    return true
  } catch (err) {
    return false
  }
}

function emitSrcsetCandidates(
  srcset: string,
  node: ReturnType<typeof parse5utilities.createNode>,
  assetType: 'staticSrc' | 'staticHref',
  attributeName: 'srcset' | 'imagesrcset',
  onResourceFound: (options: OnResourceFoundOptions) => void
) {
  for (const candidate of srcset.split(',')) {
    const url = candidate.trim().split(/\s+/)[0]
    if (!url) continue

    const {cleanPath} = cleanAssetUrl(url)
    if (cleanPath && !isUrl(cleanPath)) {
      onResourceFound({
        filePath: url,
        childNode: node,
        assetType,
        attributeName
      })
    }
  }
}

export type HtmlStaticAttribute =
  | 'src'
  | 'href'
  | 'poster'
  | 'srcset'
  | 'imagesrcset'

interface OnResourceFoundOptions {
  filePath: string
  childNode: ReturnType<typeof parse5utilities.createNode>
  assetType: 'script' | 'css' | 'staticSrc' | 'staticHref'
  // Which attribute this path came from. Static rewrites must touch this
  // attribute only: video poster must not overwrite src, and a srcset
  // candidate must not replace the whole list or invent an href.
  attributeName?: HtmlStaticAttribute
}

export function parseHtml(
  node: ReturnType<typeof parse5utilities.createNode>,
  onResourceFound: (options: OnResourceFoundOptions) => void
): void {
  if (node.nodeName === '#comment' || node.nodeName === '#text') {
    return
  }

  if (node.nodeName === 'script') {
    const src = node.attrs?.find((attr) => attr.name === 'src')?.value

    if (!src) return
    if (isUrl(src)) return

    onResourceFound({
      filePath: src,
      childNode: node,
      assetType: 'script'
    })
  } else if (node.nodeName === 'link') {
    const href = node.attrs?.find((attr) => attr.name === 'href')?.value
    const rel = node.attrs?.find((attr) => attr.name === 'rel')?.value
    const imagesrcset = node.attrs?.find(
      (attr) => attr.name === 'imagesrcset'
    )?.value

    if (imagesrcset) {
      emitSrcsetCandidates(
        imagesrcset,
        node,
        'staticHref',
        'imagesrcset',
        onResourceFound
      )
    }

    if (!href) return
    if (isUrl(href)) return

    // rel is a space-separated, case-insensitive token list, so legacy
    // rel="shortcut icon" must match icon and never count as a stylesheet.
    const nonStylesheetRelTokens = [
      'dns-prefetch',
      'icon',
      'apple-touch-icon',
      'apple-touch-icon-precomposed',
      'mask-icon',
      'manifest',
      'modulepreload',
      'preconnect',
      'prefetch',
      'preload',
      'prerender'
    ]
    const relTokens = rel ? rel.toLowerCase().split(/\s+/) : []

    if (relTokens.some((token) => nonStylesheetRelTokens.includes(token))) {
      onResourceFound({
        filePath: href,
        childNode: node,
        assetType: 'staticHref',
        attributeName: 'href'
      })
    } else {
      onResourceFound({
        filePath: href,
        childNode: node,
        assetType: 'css'
      })
    }
  } else if (
    node.nodeName === 'audio' ||
    node.nodeName === 'embed' ||
    node.nodeName === 'iframe' ||
    node.nodeName === 'img' ||
    node.nodeName === 'input' ||
    node.nodeName === 'source' ||
    node.nodeName === 'track' ||
    node.nodeName === 'video'
  ) {
    const src = node.attrs?.find((attr) => attr.name === 'src')?.value

    // src is optional. <source srcset>, <img srcset>, and <video poster>
    // must still be collected when src is missing or a remote URL.
    if (src && !isUrl(src)) {
      onResourceFound({
        filePath: src,
        childNode: node,
        assetType: 'staticSrc',
        attributeName: 'src'
      })
    }

    const srcset = node.attrs?.find((attr) => attr.name === 'srcset')?.value
    if (srcset) {
      emitSrcsetCandidates(srcset, node, 'staticSrc', 'srcset', onResourceFound)
    }

    if (node.nodeName === 'video') {
      const poster = node.attrs?.find((attr) => attr.name === 'poster')?.value
      if (poster && !isUrl(poster)) {
        onResourceFound({
          filePath: poster,
          childNode: node,
          assetType: 'staticSrc',
          attributeName: 'poster'
        })
      }
    }
  }

  const {childNodes = []} = node
  for (const childNode of childNodes) {
    if (childNode.nodeName === '#comment' || childNode.nodeName === '#text') {
      continue
    }
    parseHtml(
      childNode as ReturnType<typeof parse5utilities.createNode>,
      onResourceFound
    )
  }
}
