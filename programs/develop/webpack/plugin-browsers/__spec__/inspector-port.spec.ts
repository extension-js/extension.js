import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import Module from 'module'
import {BrowsersPlugin} from '../index'

const paths = vi.hoisted(() => {
  const path = require('node:path') as typeof import('node:path')
  const base = __dirname
  return {
    chromeInspection: path.resolve(
      base,
      '../run-chromium/setup-chrome-inspection/index.ts'
    )
  }
})

let lastChromeInspector: any = null
let lastChromiumRunner: any = null
const originalLoad = (Module as any)._load

beforeEach(() => {
  lastChromeInspector = null
  ;(Module as any)._load = function (
    request: string,
    parent: any,
    isMain: boolean
  ) {
    const isFromBrowsersIndex = parent?.id?.endsWith(
      '/plugin-browsers/index.ts'
    )
    if (isFromBrowsersIndex && request === './run-chromium') {
      class RunChromiumPlugin {
        public opts: any
        public apply = vi.fn()
        constructor(opts: any) {
          this.opts = opts
          lastChromiumRunner = this
        }
      }
      return {RunChromiumPlugin}
    }
    return originalLoad(request as any, parent, isMain)
  } as any
})

afterEach(() => {
  ;(Module as any)._load = originalLoad
  vi.restoreAllMocks()
})

function createCompiler(mode: 'development' | 'production') {
  return {options: {mode}} as any
}

vi.mock(paths.chromeInspection, () => {
  class SetupChromeInspectionStep {
    public opts: any
    public apply = vi.fn()
    constructor(opts: any) {
      this.opts = opts
      lastChromeInspector = this
    }
  }
  return {SetupChromeInspectionStep}
})

describe('Inspector CDP port derivation', () => {
  it('passes instanceId and port to inspector, enabling aligned port calculation', () => {
    const plugin = new BrowsersPlugin({
      extension: ['/path'],
      browser: 'chrome',
      port: 9222,
      instanceId: 'abcd1234ef',
      source: 'https://example.com'
    } as any)
    plugin.apply(createCompiler('development'))
    expect(lastChromeInspector).toBeTruthy()
    // Inspector receives both port and instanceId to derive CDP port consistently
    expect(lastChromeInspector.opts.port).toBe(9222)
    expect(lastChromeInspector.opts.instanceId).toBe('abcd1234ef')
  })
})
