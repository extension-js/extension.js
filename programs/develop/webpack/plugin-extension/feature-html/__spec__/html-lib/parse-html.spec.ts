import {describe, it, expect, vi, beforeEach} from 'vitest'
// Mock the parse5-utils
import {parseHtml} from '../../html-lib/parse-html'
// @ts-ignore
import parse5utils from 'parse5-utils'

vi.mock('parse5-utils', () => ({
  getAttribute: vi.fn()
}))

const setupAttributesMock = (attributes: Record<string, string>) => {
  parse5utils.getAttribute.mockImplementation(
    (_node: any, attr: any) => attributes[attr]
  )
}

describe.skip('parseHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should find script tags and call onResourceFound with correct options', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'script',
          attrs: [{name: 'src', value: 'script.js'}]
        }
      ]
    }

    setupAttributesMock({src: 'script.js'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith({
      filePath: 'script.js',
      childNode: mockNode.childNodes[0],
      assetType: 'script'
    })
  })

  it('should ignore script tags with external URLs', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'script',
          attrs: [{name: 'src', value: 'https://cezaraugusto.com/script.js'}]
        }
      ]
    }

    setupAttributesMock({src: 'https://cezaraugusto.com/script.js'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).not.toHaveBeenCalled()
  })

  it('should find link tags for CSS and call onResourceFound with correct options', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'link',
          attrs: [
            {name: 'href', value: 'styles.css'},
            {name: 'rel', value: 'stylesheet'}
          ]
        }
      ]
    }

    setupAttributesMock({href: 'styles.css', rel: 'stylesheet'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith({
      filePath: 'styles.css',
      childNode: mockNode.childNodes[0],
      assetType: 'css'
    })
  })

  it('should handle link tags for non-CSS resources correctly', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'link',
          attrs: [
            {name: 'href', value: 'favicon.ico'},
            {name: 'rel', value: 'icon'}
          ]
        }
      ]
    }

    setupAttributesMock({href: 'favicon.ico', rel: 'icon'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith({
      filePath: 'favicon.ico',
      childNode: mockNode.childNodes[0],
      assetType: 'staticHref'
    })
  })

  it('should parse static assets with href attribute correctly', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'a',
          attrs: [{name: 'href', value: 'document.pdf'}]
        }
      ]
    }

    setupAttributesMock({href: 'document.pdf'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith({
      filePath: 'document.pdf',
      childNode: mockNode.childNodes[0],
      assetType: 'staticHref'
    })
  })

  it('should handle static assets with src attribute correctly', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'img',
          attrs: [{name: 'src', value: 'image.png'}]
        }
      ]
    }

    setupAttributesMock({src: 'image.png'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith({
      filePath: 'image.png',
      childNode: mockNode.childNodes[0],
      assetType: 'staticSrc'
    })
  })

  it('should recursively parse nested HTML structures and find assets', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'div',
          childNodes: [
            {
              nodeName: 'script',
              attrs: [{name: 'src', value: 'nested/script.js'}]
            }
          ]
        }
      ]
    }

    setupAttributesMock({src: 'nested/script.js'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith({
      filePath: 'nested/script.js',
      childNode: mockNode.childNodes[0].childNodes[0],
      assetType: 'script'
    })
  })

  it('should skip tags with empty src or href attributes', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'script',
          // Empty src attribute
          attrs: [{name: 'src', value: ''}]
        },
        {
          nodeName: 'link',
          // Empty href attribute
          attrs: [{name: 'href', value: ''}]
        }
      ]
    }

    setupAttributesMock({src: '', href: ''})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).not.toHaveBeenCalled()
  })

  it('should ignore script and link tags without src or href attributes, respectively', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'script',
          // Missing src attribute
          attrs: []
        },
        {
          nodeName: 'link',
          // Missing href attribute
          attrs: [{name: 'rel', value: 'stylesheet'}]
        }
      ]
    }

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).not.toHaveBeenCalled()
  })

  it('handles HTML entities and escaped characters in src attributes', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'img',
          attrs: [{name: 'src', value: 'image%20with%20spaces.png'}]
        }
      ]
    }

    setupAttributesMock({src: 'image%20with%20spaces.png'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'image%20with%20spaces.png',
        assetType: 'staticSrc'
      })
    )
  })

  it('differentiates between relative and absolute paths in href attributes', () => {
    const onResourceFound = vi.fn()
    const mockNode1 = {
      childNodes: [
        {
          nodeName: 'link',
          attrs: [{name: 'href', value: '/absolute/path/style.css'}]
        }
      ]
    }

    const mockNode2 = {
      childNodes: [
        {
          nodeName: 'link',
          attrs: [{name: 'href', value: 'relative/path/style.css'}]
        }
      ]
    }

    setupAttributesMock({href: '/absolute/path/style.css'})

    parseHtml(mockNode1, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/absolute/path/style.css',
        assetType: 'css'
      })
    )

    setupAttributesMock({href: 'relative/path/style.css'})

    parseHtml(mockNode2, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'relative/path/style.css',
        assetType: 'css'
      })
    )
  })

  it('ignores fragment identifiers and query parameters in asset URLs', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'script',
          attrs: [{name: 'src', value: 'script.js?version=1.2#section'}]
        }
      ]
    }

    setupAttributesMock({src: 'script.js?version=1.2#section'})

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'script.js?version=1.2#section',
        assetType: 'script'
      })
    )
  })

  it('correctly ignores data URLs in src attributes', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'img',
          attrs: [
            {
              name: 'src',
              value: 'data:image/png;base64,abcdef'
            }
          ]
        }
      ]
    }

    setupAttributesMock({
      src: 'data:image/png;base64,abcdef'
    })

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).not.toHaveBeenCalled()
  })
  it('does not attempt to extract embedded JavaScript or CSS', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: 'script',
          childNodes: [
            {nodeName: '#text', value: 'console.log("Hello, world!");'}
          ]
        },
        {
          nodeName: 'style',
          childNodes: [
            {nodeName: '#text', value: 'body { background-color: #000; }'}
          ]
        }
      ]
    }

    parseHtml(mockNode, onResourceFound)

    expect(onResourceFound).not.toHaveBeenCalled()
  })
  it('skips assets within HTML comments', () => {
    const onResourceFound = vi.fn()
    const mockNode = {
      childNodes: [
        {
          nodeName: '#comment',
          data: '<script src="commented/script.js"></script>'
        },
        {
          nodeName: 'script',
          attrs: [{name: 'src', value: 'actual/script.js'}]
        }
      ]
    }

    setupAttributesMock({src: 'actual/script.js'})

    parseHtml(mockNode, onResourceFound)

    // Ensure only the actual script outside comments is found
    expect(onResourceFound).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'actual/script.js',
        assetType: 'script'
      })
    )
  })
})
