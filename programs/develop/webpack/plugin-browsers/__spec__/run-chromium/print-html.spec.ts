import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {ChromiumSourceInspectionPlugin as Step} from '../../run-chromium/chromium-source-inspection'

describe('SetupChromeInspectionStep print behavior', () => {
  let logSpy: any
  let warnSpy: any
  const html =
    '<html><body><div data-extension-root="true"></div></body></html>'

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('prints HTML body in pretty output', async () => {
    const step = new Step({
      browser: 'chrome',
      mode: 'development',
      sourceFormat: 'pretty'
    } as any)
    // @ts-ignore private
    await step.printHTML(html)
    expect(logSpy).toHaveBeenCalledWith(html)
  })

  it('prints header, body, footer for HTML output', async () => {
    const step = new Step({
      browser: 'chrome',
      mode: 'development',
      sourceFormat: 'pretty'
    } as any)
    // @ts-ignore private
    await step.printHTML('<html></html>')
    expect(logSpy).toHaveBeenCalled()
  })
})
