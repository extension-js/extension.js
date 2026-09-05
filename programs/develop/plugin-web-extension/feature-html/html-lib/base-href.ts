// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {getBaseNode, isUrl} from './utils'

type HtmlNode = {
  nodeName?: string
  attrs?: Array<{name: string; value: string}>
  childNodes?: HtmlNode[]
}

// Attributes whose value the browser resolves through <base href> as a
// navigation, not as a file the build ships.
const LINK_ATTRIBUTES: Record<string, string> = {
  a: 'href',
  area: 'href',
  form: 'action'
}

function isBakeable(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('#')) return false
  if (trimmed.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false
  return true
}

export function resolveLinkThroughBase(
  baseHref: string,
  value: string
): string {
  if (isUrl(baseHref)) return new URL(value, baseHref).href
  if (value.startsWith('/')) return value
  const joined = path.posix.join(baseHref.replace(/\\/g, '/'), value)
  return baseHref.startsWith('/') && !joined.startsWith('/')
    ? `/${joined}`
    : joined
}

function walk(node: HtmlNode, visit: (node: HtmlNode) => void) {
  visit(node)
  for (const child of node.childNodes || []) walk(child, visit)
}

// The built page keeps its own location as the document base, so asset
// references rewritten to the extension root stay inside the extension.
// The author's <base href> lives on in the links it was meant to move.
export function bakeBaseHref(htmlDocument: HtmlNode): void {
  const baseNode = getBaseNode(htmlDocument) as HtmlNode | undefined
  const baseHref = baseNode?.attrs?.find((attr) => attr.name === 'href')?.value
  if (!baseNode || !baseHref) return

  walk(htmlDocument, (node) => {
    const attrName = LINK_ATTRIBUTES[String(node.nodeName || '')]
    if (!attrName) return
    const attr = node.attrs?.find((entry) => entry.name === attrName)
    if (!attr || !isBakeable(attr.value)) return
    attr.value = resolveLinkThroughBase(baseHref, attr.value.trim())
  })

  baseNode.attrs = (baseNode.attrs || []).filter((attr) => attr.name !== 'href')
  if (baseNode.attrs.length === 0) {
    walk(htmlDocument, (node) => {
      if (!node.childNodes) return
      node.childNodes = node.childNodes.filter((child) => child !== baseNode)
    })
  }
}
