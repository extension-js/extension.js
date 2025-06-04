import {describe, it, expect} from 'vitest'
import {parseHtml} from '../../html-lib/parse-html'
import {
  createHtmlDocument,
  createScriptNode,
  createLinkNode,
  createImageNode,
  createAnchorNode,
  createCommentNode,
  createTextNode,
  type HtmlNode
} from './test-utils'

describe('parseHtml', () => {
  it('should parse script tags', () => {
    const mockNode = createHtmlDocument([createScriptNode('app.js')]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(1)
    expect(resources[0]).toEqual({
      filePath: 'app.js',
      childNode: mockNode.childNodes[0].childNodes[0],
      assetType: 'script'
    })
  })

  it('should parse link tags', () => {
    const mockNode = createHtmlDocument([createLinkNode('styles.css')]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(1)
    expect(resources[0]).toEqual({
      filePath: 'styles.css',
      childNode: mockNode.childNodes[0].childNodes[0],
      assetType: 'css'
    })
  })

  it('should parse static assets with src attribute', () => {
    const mockNode = createHtmlDocument([createImageNode('image.png')]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(1)
    expect(resources[0]).toEqual({
      filePath: 'image.png',
      childNode: mockNode.childNodes[0].childNodes[0],
      assetType: 'staticSrc'
    })
  })

  it('should parse static assets with href attribute', () => {
    const mockNode = createHtmlDocument([
      createAnchorNode('document.pdf')
    ]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(1)
    expect(resources[0]).toEqual({
      filePath: 'document.pdf',
      childNode: mockNode.childNodes[0].childNodes[0],
      assetType: 'staticHref'
    })
  })

  it('should ignore comment nodes', () => {
    const mockNode = createHtmlDocument([
      createCommentNode('This is a comment')
    ]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(0)
  })

  it('should ignore text nodes', () => {
    const mockNode = createHtmlDocument([createTextNode('This is text')]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(0)
  })

  it('should parse nested HTML structure', () => {
    const mockNode = createHtmlDocument([
      createScriptNode('app.js'),
      createLinkNode('styles.css'),
      createImageNode('image.png')
    ]) as any

    const resources: Array<{
      filePath: string
      childNode: HtmlNode
      assetType: string
    }> = [] as any
    parseHtml(mockNode, (options) => {
      resources.push(options as any)
    })

    expect(resources).toHaveLength(3)
    expect(resources[0]).toEqual({
      filePath: 'app.js',
      childNode: mockNode.childNodes[0].childNodes[0],
      assetType: 'script'
    })
    expect(resources[1]).toEqual({
      filePath: 'styles.css',
      childNode: mockNode.childNodes[0].childNodes[1],
      assetType: 'css'
    })
    expect(resources[2]).toEqual({
      filePath: 'image.png',
      childNode: mockNode.childNodes[0].childNodes[2],
      assetType: 'staticSrc'
    })
  })
})
