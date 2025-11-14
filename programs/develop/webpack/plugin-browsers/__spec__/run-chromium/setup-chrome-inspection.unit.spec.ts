import {describe, it, expect, vi, beforeEach} from 'vitest'

// Mocks for dependencies used by SetupChromeInspectionStep
vi.mock('../../run-chromium/chromium-source-inspection/readiness', () => ({
  waitForChromeRemoteDebugging: vi.fn(async () => undefined)
}))

vi.mock('../../run-chromium/chromium-source-inspection/cdp-client', () => {
  class MockCDPClient {
    constructor(_port: number) {}
    async connect() {}
    async waitForLoadEvent(_sessionId?: string | null) {}
    async waitForContentScriptInjection(_sessionId?: string | null) {}
    async evaluate(_sessionId: string | null, _expr: string) {
      return true
    }
    async getPageHTML(_sessionId?: string | null) {
      return '<html></html>'
    }
    async closeTarget(_targetId: string) {}
    disconnect() {}
  }
  return {CDPClient: MockCDPClient}
})

vi.mock('../../run-chromium/chromium-source-inspection/targets', () => ({
  ensureTargetAndSession: vi.fn(async () => ({targetId: 't', sessionId: 's'}))
}))

vi.mock('../../run-chromium/chromium-source-inspection/extract', () => ({
  extractPageHtml: vi.fn(async () => '<html>ok</html>')
}))

import {ChromiumSourceInspectionPlugin as SetupChromeInspectionStep} from '../../run-chromium/chromium-source-inspection'

describe('SetupChromeInspectionStep (unit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes and inspects source returning HTML', async () => {
    const step = new SetupChromeInspectionStep({browser: 'chrome', port: 9222})
    // initialize()
    await step.initialize(9222)
    // inspectSource()
    const html = await step.inspectSource('http://example/')
    expect(typeof html).toBe('string')
    expect(html).toContain('html')
  })

  it('starts watching using websocket server mock without errors (dev only)', async () => {
    process.env.EXTENSION_ENV = 'development'
    const step = new SetupChromeInspectionStep({
      browser: 'chrome',
      port: 9222,
      watchSource: true
    })
    await step.initialize(9222)
    const ws: any = {clients: new Set([{on: vi.fn()}]), on: vi.fn()}
    await step.startWatching(ws)
    expect(ws.on).toHaveBeenCalled()
  })
})
