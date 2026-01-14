import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {BrowsersPlugin} from '../index'

let lastChromiumRunner: any = null

vi.mock('../run-chromium', () => {
  class RunChromiumPlugin {
    public opts: any
    public apply = vi.fn()
    constructor(opts: any) {
      this.opts = opts
      lastChromiumRunner = this
    }
  }
  return {RunChromiumPlugin}
})

afterEach(() => {
  vi.restoreAllMocks()
})

function createCompiler(mode: 'development' | 'production') {
  return {options: {mode}} as any
}

describe('Port fallback', () => {
  it('keeps requested port when free (no mutation of flags observable via plugin opts)', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'chrome',
      port: 9222,
      source: 'https://example.com'
    } as any)
    // Use production to avoid invoking dev-only inspection step
    plugin.apply(createCompiler('production'))
    expect(lastChromiumRunner).toBeTruthy()
    // We cannot directly read flags here, but ensure opts propagate source & port
    expect(lastChromiumRunner.opts.port).toBe(9222)
    expect(lastChromiumRunner.opts.source).toBe('https://example.com')
  })
})

