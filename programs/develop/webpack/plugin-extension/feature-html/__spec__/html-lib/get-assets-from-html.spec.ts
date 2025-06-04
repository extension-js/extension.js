import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {getAssetsFromHtml} from '../../html-lib/utils'

vi.mock('fs', () => ({
  readFileSync: vi.fn()
}))

describe('getAssetsFromHtml', () => {
  const htmlFilePath = '/path/to/index.html'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use htmlContent parameter if provided', () => {
    const htmlContent =
      '<html><head><link rel="stylesheet" href="styles.css"></head></html>'
    ;(fs.readFileSync as any).mockReturnValue('This should not be read')

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(assets?.css).toEqual(['/path/to/styles.css'])
  })

  it('should return empty arrays if HTML has no assets', () => {
    ;(fs.readFileSync as any).mockReturnValue('<html></html>')

    const assets = getAssetsFromHtml(htmlFilePath)

    expect(assets?.css).toEqual([])
    expect(assets?.js).toEqual([])
    expect(assets?.static).toEqual([])
  })

  it('should ignore external URLs for assets', () => {
    const htmlContent =
      '<html><head><script src="https://cezaraugusto.com/script.js"></script></head></html>'

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(assets?.js).toEqual([])
  })

  it('should extract JavaScript files', () => {
    const htmlContent =
      '<html><head><script src="app.js"></script></head></html>'

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(assets?.js).toEqual(['/path/to/app.js'])
  })

  it('should extract CSS files', () => {
    const htmlContent =
      '<html><head><link rel="stylesheet" href="styles.css"></head></html>'

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(assets?.css).toEqual(['/path/to/styles.css'])
  })

  it('should extract static assets', () => {
    const htmlContent = '<html><body><img src="image.png"></body></html>'

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(assets?.static).toEqual(['/path/to/image.png'])
  })

  it('should handle public paths correctly', () => {
    const htmlContent =
      '<html><head><link rel="stylesheet" href="/public/styles.css"></head></html>'

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent, 'public')

    expect(assets?.css).toEqual(['/public/styles.css'])
  })

  it('should handle relative paths correctly', () => {
    const htmlContent =
      '<html><head><link rel="stylesheet" href="./styles.css"></head></html>'

    const assets = getAssetsFromHtml(htmlFilePath, htmlContent)

    expect(assets?.css).toEqual(['/path/to/styles.css'])
  })
})
