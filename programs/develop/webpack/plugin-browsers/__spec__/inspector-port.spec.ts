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

describe('Inspector port derivation', () => {
  it('passes requested port to runner opts for derivation and fallback', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'chrome',
      port: 9444
    } as any)
    plugin.apply(createCompiler('production'))
    expect(lastChromiumRunner).toBeTruthy()
    expect(lastChromiumRunner.opts.port).toBe(9444)
  })
})

