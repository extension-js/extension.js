export interface HtmlNode {
  nodeName: string
  attrs: Array<{name: string; value: string}>
  childNodes: HtmlNode[]
  value?: string
  data?: string
}

export function createHtmlNode(options: Partial<HtmlNode>): HtmlNode {
  return {
    nodeName: options.nodeName || 'div',
    attrs: options.attrs || [],
    childNodes: options.childNodes || [],
    value: options.value,
    data: options.data
  }
}

export function createHtmlDocument(childNodes: HtmlNode[]): HtmlNode {
  return {
    nodeName: 'html',
    attrs: [],
    childNodes: [
      {
        nodeName: 'head',
        attrs: [],
        childNodes
      }
    ]
  }
}

export function createScriptNode(src: string): HtmlNode {
  return {
    nodeName: 'script',
    attrs: [{name: 'src', value: src}],
    childNodes: []
  }
}

export function createLinkNode(
  href: string,
  rel: string = 'stylesheet'
): HtmlNode {
  return {
    nodeName: 'link',
    attrs: [
      {name: 'href', value: href},
      {name: 'rel', value: rel}
    ],
    childNodes: []
  }
}

export function createImageNode(src: string): HtmlNode {
  return {
    nodeName: 'img',
    attrs: [{name: 'src', value: src}],
    childNodes: []
  }
}

export function createAnchorNode(href: string): HtmlNode {
  return {
    nodeName: 'a',
    attrs: [{name: 'href', value: href}],
    childNodes: []
  }
}

export function createCommentNode(text: string): HtmlNode {
  return {
    nodeName: '#comment',
    attrs: [],
    childNodes: [],
    data: text
  }
}

export function createTextNode(text: string): HtmlNode {
  return {
    nodeName: '#text',
    attrs: [],
    childNodes: [],
    value: text
  }
}

