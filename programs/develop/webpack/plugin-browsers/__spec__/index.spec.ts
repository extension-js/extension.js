import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// ESM-friendly mocks for runner plugins and inspection steps
let lastChromiumRunner: any = null
let lastFirefoxRunner: any = null
let lastChromeInspector: any = null
let lastFirefoxInspector: any = null

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

vi.mock('../run-firefox', () => {
  class RunFirefoxPlugin {
    public opts: any
    public apply = vi.fn()
    constructor(opts: any) {
      this.opts = opts
      lastFirefoxRunner = this
    }
  }
  return {RunFirefoxPlugin}
})

beforeEach(() => {
  lastChromiumRunner = null
  lastFirefoxRunner = null
  lastChromeInspector = null
  lastFirefoxInspector = null
})

vi.mock('../run-firefox/firefox-source-inspection', () => {
  class FirefoxSourceInspectionPlugin {
    public opts: any
    public apply = vi.fn()
    constructor(opts: any) {
      this.opts = opts
      lastFirefoxInspector = this
    }
  }
  return {FirefoxSourceInspectionPlugin}
})

// Module under test
import {BrowsersPlugin} from '../index'

function createCompiler(mode: 'development' | 'production') {
  return {options: {mode}} as any
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BrowsersPlugin', () => {
  it('exposes a stable static name', () => {
    expect(BrowsersPlugin.name).toBe('plugin-browsers')
  })

  it('selects browser based on binary hints', () => {
    const chromium = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'firefox',
      chromiumBinary: '/custom/chromium'
    } as any)
    expect(chromium.browser).toBe('chromium-based')

    const gecko = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'chrome',
      geckoBinary: '/custom/firefox'
    } as any)
    expect(gecko.browser).toBe('gecko-based')
  })

  it('filters --load-extension flags from browserFlags and extension mix', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'chrome',
      browserFlags: ['--hide-scrollbars', '--load-extension=/another']
    } as any)

    // browserFlags should exclude any load-extension flags
    expect(plugin.browserFlags).toEqual(['--hide-scrollbars'])
    // extension property should remain as provided (no flags mixed in)
    expect(plugin.extension).toEqual(['/path/to/ext'])
  })

  it('dispatches to Chromium runner for chrome/edge/chromium-based', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'chrome',
      excludeBrowserFlags: ['--mute-audio']
    } as any)
    const compiler = createCompiler('development')
    plugin.apply(compiler)

    expect(lastChromiumRunner).toBeTruthy()
    expect(lastChromiumRunner.apply).toHaveBeenCalledTimes(1)
    expect(lastChromiumRunner.opts.browser).toBe('chrome')
    expect(lastChromiumRunner.opts.excludeBrowserFlags).toEqual([
      '--mute-audio'
    ])
  })

  it('dispatches to Firefox runner for firefox/gecko-based', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      browser: 'firefox',
      excludeBrowserFlags: ['--mute-audio']
    } as any)
    const compiler = createCompiler('development')
    plugin.apply(compiler)

    expect(lastFirefoxRunner).toBeTruthy()
    expect(lastFirefoxRunner.apply).toHaveBeenCalledTimes(1)
    expect(lastFirefoxRunner.opts.browser).toBe('firefox')
    expect(lastFirefoxRunner.opts.excludeBrowserFlags).toEqual(['--mute-audio'])
  })

  it('logs and rethrows for unsupported browsers', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path/to/ext'],
      // @ts-expect-error testing invalid browser
      browser: 'safari'
    })
    const compiler = createCompiler('development')
    expect(() => plugin.apply(compiler)).toThrowError()
    expect(console.error).toHaveBeenCalled()
  })
})

