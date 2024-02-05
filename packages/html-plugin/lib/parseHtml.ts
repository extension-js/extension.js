// @ts-ignore
import parse5utils from 'parse5-utils'

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
  childNode: any
  assetType: 'script' | 'css' | 'staticSrc' | 'staticHref'
}

export default function parseHtml(
  node: any,
  onResourceFound: (options: OnResourceFoundOptions) => void
) {
  const {childNodes = []} = node

  for (const childNode of childNodes) {
    // Handle <script> tags
    if (childNode.nodeName === 'script') {
      const src = parse5utils.getAttribute(childNode, 'src')

      // Some scripts have no src
      if (!src) continue
      // Do nothing for urls
      if (isUrl(src)) continue

      onResourceFound({
        filePath: src,
        childNode,
        assetType: 'script'
      })
    } else if (childNode.nodeName === 'link') {
      const href = parse5utils.getAttribute(childNode, 'href')
      const rel = parse5utils.getAttribute(childNode, 'rel')

      // Some links have no href
      if (!href) continue
      // Do nothing for urls
      if (isUrl(href)) continue

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
          childNode,
          assetType: 'staticHref'
        })
      } else {
        onResourceFound({
          filePath: href,
          childNode,
          assetType: 'css'
        })
      }

      // Handle static assets
    } else {
      // Static assets with href attribute
      if (childNode.nodeName === 'a' || childNode.nodeName === 'area') {
        const href = parse5utils.getAttribute(childNode, 'href')

        // Some elements have no href
        if (!href) continue
        // Do nothing for urls
        if (isUrl(href)) continue

        onResourceFound({
          filePath: href,
          childNode,
          assetType: 'staticHref'
        })

        // Static assets with src attribute
      } else if (
        childNode.nodeName === 'audio' ||
        childNode.nodeName === 'embed' ||
        childNode.nodeName === 'iframe' ||
        childNode.nodeName === 'img' ||
        childNode.nodeName === 'input' ||
        childNode.nodeName === 'source' ||
        childNode.nodeName === 'track' ||
        childNode.nodeName === 'video'
      ) {
        const src = parse5utils.getAttribute(childNode, 'src')

        // Some elements have no src
        if (!src) continue
        // Do nothing for urls
        if (isUrl(src)) continue

        onResourceFound({
          filePath: src,
          childNode,
          assetType: 'staticSrc'
        })

        // Handle child nodes recursively
      } else {
        parseHtml(childNode, onResourceFound)
      }
    }
  }
}
