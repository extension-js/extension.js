import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
// @ts-ignore
import parse5utils from 'parse5-utils'
import {getAssetsFromHtml} from '../../html-lib/utils'

vi.mock('fs', () => ({
  readFileSync: vi.fn()
}))

vi.mock('parse5-utils', () => ({
  parse: vi.fn(),
  getAttribute: vi.fn()
}))

const setupParseMock = (htmlDocument: any) => {
  ;(parse5utils.parse as any).mockImplementation(() => htmlDocument)
}

function createMockHtmlDocument(childNodes: any[]): any {
  return {
    childNodes: [
      {
        nodeName: 'html',
        childNodes
      }
    ]
  }
}

describe('getAssetsFromHtml', () => {
  const htmlFilePath = '/path/to/index.html'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use htmlContent parameter if provided', () => {
    const htmlContent =
      '<html><head><link rel="stylesheet" href="styles.css"></head></html>'
    ;(fs.readFileSync as any).mockReturnValue('This should not be read')
    setupParseMock(createMockHtmlDocument([]))

    getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(parse5utils.parse).toHaveBeenCalledWith(htmlContent)
  })

  it('should return empty arrays if HTML has no assets', () => {
    setupParseMock(createMockHtmlDocument([]))
    ;(fs.readFileSync as any).mockReturnValue('<html></html>')

    const assets = getAssetsFromHtml(htmlFilePath)

    expect(assets?.css).toEqual([])
    expect(assets?.js).toEqual([])
    expect(assets?.static).toEqual([])
  })

  it('should ignore external URLs for assets', () => {
    const htmlContent =
      '<html><head><script src="https://cezaraugusto.com/script.js"></script></head></html>'
    setupParseMock(
      createMockHtmlDocument([
        {
          nodeName: 'script',
          attrs: [{name: 'src', value: 'https://cezaraugusto.com/script.js'}]
        }
      ])
    )

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(assets?.js).toEqual([])
  })
})
