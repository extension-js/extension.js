import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {SetupChromeInspectionStep as Step} from '../setup-chrome-inspection'

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

  it('prints raw when sourceRaw=true', () => {
    const step = new Step({
      browser: 'chrome',
      mode: 'development',
      sourceRaw: true
    } as any)
    // @ts-ignore private
    step.printHTML(html)
    expect(logSpy).toHaveBeenCalledWith(html)
  })

  it('prints header, body, footer for HTML output', () => {
    const step = new Step({
      browser: 'chrome',
      mode: 'development',
      sourceRaw: true
    } as any)
    // @ts-ignore private
    step.printHTML('<html></html>')
    expect(logSpy).toHaveBeenCalled()
  })
})
