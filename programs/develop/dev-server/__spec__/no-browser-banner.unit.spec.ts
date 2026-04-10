import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {setupNoBrowserBannerOnFirstDone} from '../compiler-hooks'

describe('setupNoBrowserBannerOnFirstDone', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('prints "ready for development" and banner on first successful compile', () => {
    const compiler: any = {
      hooks: {
        done: {
          tap: vi.fn((_name: string, fn: (stats: any) => void) => {
            // Simulate first done without errors
            fn({hasErrors: () => false})
          })
        }
      }
    }

    setupNoBrowserBannerOnFirstDone({
      compiler,
      browser: 'chromium',
      manifestPath: '/proj/manifest.json',
      readyPath: '/proj/dist/chromium/.extension-ready.json'
    })

    expect(compiler.hooks.done.tap).toHaveBeenCalledWith(
      'extension.js:no-browser-banner',
      expect.any(Function)
    )

    const tapFn = (compiler.hooks.done.tap as any).mock.calls[0][1]
    tapFn({hasErrors: () => false})

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toMatch(/ready for development/i)
    expect(output).toMatch(/Extension\.js/)
  })

  it('does not print when compilation has errors', () => {
    const compiler: any = {
      hooks: {
        done: {
          tap: vi.fn((_name: string, fn: (stats: any) => void) => {
            fn({hasErrors: () => true})
          })
        }
      }
    }

    setupNoBrowserBannerOnFirstDone({
      compiler,
      browser: 'chromium',
      manifestPath: '/proj/manifest.json',
      readyPath: '/proj/dist/chromium/.extension-ready.json'
    })

    const tapFn = (compiler.hooks.done.tap as any).mock.calls[0][1]
    tapFn({hasErrors: () => true})

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).not.toMatch(/ready for development/i)
  })
})
