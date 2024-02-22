import getAssetsFromHtml from '../../lib/getAssetsFromHtml'
import fs from 'fs'
// @ts-ignore
import parse5utils from 'parse5-utils'

jest.mock('fs', () => ({
  readFileSync: jest.fn()
}))

jest.mock('parse5-utils', () => ({
  parse: jest.fn(),
  getAttribute: jest.fn()
}))

const setupParseMock = (htmlDocument: any) => {
  ;(parse5utils.parse as jest.Mock).mockImplementation(() => htmlDocument)
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
    jest.clearAllMocks()
  })

  it('should use htmlContent parameter if provided', () => {
    const htmlContent =
      '<html><head><link rel="stylesheet" href="styles.css"></head></html>'
    ;(fs.readFileSync as jest.Mock).mockReturnValue('This should not be read')
    setupParseMock(createMockHtmlDocument([]))

    getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(parse5utils.parse).toHaveBeenCalledWith(htmlContent)
  })

  it('should return empty arrays if HTML has no assets', () => {
    setupParseMock(createMockHtmlDocument([]))
    ;(fs.readFileSync as jest.Mock).mockReturnValue('<html></html>')

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
