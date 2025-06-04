import * as parse5utilities from 'parse5-utilities'

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
  // Skip comment and text nodes
  if (node.nodeName === '#comment' || node.nodeName === '#text') {
    return
  }

  // Handle the current node first
  if (node.nodeName === 'script') {
    const src = node.attrs?.find((attr) => attr.name === 'src')?.value

    // Some scripts have no src
    if (!src) return
    // Do nothing for urls
    if (isUrl(src)) return

    onResourceFound({
      filePath: src,
      childNode: node,
      assetType: 'script'
    })
  } else if (node.nodeName === 'link') {
    const href = node.attrs?.find((attr) => attr.name === 'href')?.value
    const rel = node.attrs?.find((attr) => attr.name === 'rel')?.value

    // Some links have no href
    if (!href) return
    // Do nothing for urls
    if (isUrl(href)) return

    // Assume users ignored the "stylesheet" attribute,
    // but ensure it's not an icon or something else.
    // See https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types.
    if (
      rel === 'dns-prefetch' ||
      rel === 'icon' ||
      rel === 'manifest' ||
      rel === 'modulepreload' ||
      rel === 'preconnect' ||
      rel === 'prefetch' ||
      rel === 'preload' ||
      rel === 'prerender'
    ) {
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
  } else if (node.nodeName === 'a' || node.nodeName === 'area') {
    // Static assets with href attribute
    const href = node.attrs?.find((attr) => attr.name === 'href')?.value

    // Some elements have no href
    if (!href) return
    // Do nothing for urls
    if (isUrl(href)) return

    onResourceFound({
      filePath: href,
      childNode: node,
      assetType: 'staticHref'
    })
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
    // Static assets with src attribute
    const src = node.attrs?.find((attr) => attr.name === 'src')?.value

    // Some elements have no src
    if (!src) return
    // Do nothing for urls
    if (isUrl(src)) return

    onResourceFound({
      filePath: src,
      childNode: node,
      assetType: 'staticSrc'
    })
  }

  // Then handle child nodes recursively
  const {childNodes = []} = node
  for (const childNode of childNodes) {
    // Skip comment and text nodes
    if (childNode.nodeName === '#comment' || childNode.nodeName === '#text') {
      continue
    }
    // Type assertion to handle parse5-utilities node types
    parseHtml(
      childNode as ReturnType<typeof parse5utilities.createNode>,
      onResourceFound
    )
  }
}
