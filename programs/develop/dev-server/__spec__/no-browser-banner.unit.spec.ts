import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {
  type FirstDoneStats,
  setupNoBrowserBannerOnFirstDone
} from '../compiler-hooks'

type DoneTap = (stats: FirstDoneStats) => void

describe('setupNoBrowserBannerOnFirstDone', () => {
  let consoleSpy: MockInstance<typeof console.log>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('prints "ready for development" and banner on first successful compile', () => {
    const compiler = {
      hooks: {
        done: {
          tap: vi.fn((_name: string, fn: DoneTap) => {
            fn({hasErrors: () => false})
          })
        }
      }
    }

    setupNoBrowserBannerOnFirstDone({
      compiler,
      browser: 'chromium',
      manifestPath: '/proj/manifest.json',
      readyPath: '/proj/dist/chromium/.extension-ready.json',
      distPath: '/proj/dist/chromium'
    })

    expect(compiler.hooks.done.tap).toHaveBeenCalledWith(
      'extension.js:no-browser-banner',
      expect.any(Function)
    )

    const tapFn = compiler.hooks.done.tap.mock.calls[0][1]
    tapFn({hasErrors: () => false})

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toMatch(/ready for development/i)
    expect(output).toMatch(/Extension\.js/)
    expect(output).toContain('(no-browser mode)')
    expect(output).toContain('Output')
    expect(output).toContain('/proj/dist/chromium')

    expect(output.indexOf('Extension.js')).toBeLessThan(
      output.search(/ready for development/i)
    )
  })

  it('does not print when compilation has errors', () => {
    const compiler = {
      hooks: {
        done: {
          tap: vi.fn((_name: string, fn: DoneTap) => {
            fn({hasErrors: () => true})
          })
        }
      }
    }

    setupNoBrowserBannerOnFirstDone({
      compiler,
      browser: 'chromium',
      manifestPath: '/proj/manifest.json',
      readyPath: '/proj/dist/chromium/.extension-ready.json',
      distPath: '/proj/dist/chromium'
    })

    const tapFn = compiler.hooks.done.tap.mock.calls[0][1]
    tapFn({hasErrors: () => true})

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).not.toMatch(/ready for development/i)
  })
})
