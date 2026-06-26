import {describe, it, expect, vi, afterEach} from 'vitest'
import {extractPageHtml} from '../run-chromium/chromium-source-inspection/extract'

const makeClient = () => ({
  getPageHTML: vi.fn(async () => ''),
  getTargets: vi.fn(async () => {
    throw new Error('getTargets boom')
  }),
  attachToTarget: vi.fn(async () => 'session-2'),
  waitForContentScriptInjection: vi.fn(async () => true),
  evaluate: vi.fn(async () => {
    throw new Error('evaluate boom')
  }),
  getClosedShadowRoots: vi.fn(async () => [])
})

describe('extractPageHtml fallback diagnostics (unit)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports a swallowed extraction-fallback failure when author samples are on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const html = await extractPageHtml(makeClient() as any, 'session-1', true)

    expect(html).toBe('')
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes('Chrome HTML extraction step')
      )
    ).toBe(true)
  })

  it('stays silent about fallback failures when author samples are off', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const html = await extractPageHtml(makeClient() as any, 'session-1', false)

    expect(html).toBe('')
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes('Chrome HTML extraction step')
      )
    ).toBe(false)
  })
})
