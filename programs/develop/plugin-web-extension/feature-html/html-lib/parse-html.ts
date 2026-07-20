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

interface OnResourceFoundOptions {
  filePath: string
  childNode: ReturnType<typeof parse5utilities.createNode>
  assetType: 'script' | 'css' | 'staticSrc' | 'staticHref'
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
      for (const candidate of imagesrcset.split(',')) {
        const url = candidate.trim().split(/\s+/)[0]

        if (!url) continue

        const {cleanPath} = cleanAssetUrl(url)
        if (cleanPath && !isUrl(cleanPath)) {
          onResourceFound({
            filePath: cleanPath,
            childNode: node,
            assetType: 'staticHref'
          })
        }
      }
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
        assetType: 'staticHref'
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

    if (!src) return
    if (isUrl(src)) return

    onResourceFound({
      filePath: src,
      childNode: node,
      assetType: 'staticSrc'
    })

    const srcset = node.attrs?.find((attr) => attr.name === 'srcset')?.value
    if (srcset) {
      const candidates = srcset.split(',')
      for (const candidate of candidates) {
        const parts = candidate.trim().split(/\s+/)
        const url = parts[0]
        if (!url) continue
        const {cleanPath} = cleanAssetUrl(url)
        if (cleanPath && !isUrl(cleanPath)) {
          onResourceFound({
            filePath: cleanPath,
            childNode: node,
            assetType: 'staticSrc'
          })
        }
      }
    }

    if (node.nodeName === 'video') {
      const poster = node.attrs?.find((attr) => attr.name === 'poster')?.value
      if (poster && !isUrl(poster)) {
        const {cleanPath} = cleanAssetUrl(poster)
        if (cleanPath) {
          onResourceFound({
            filePath: cleanPath,
            childNode: node,
            assetType: 'staticSrc'
          })
        }
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
