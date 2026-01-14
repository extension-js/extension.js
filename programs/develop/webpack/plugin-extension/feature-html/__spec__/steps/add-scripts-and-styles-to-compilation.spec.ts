import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => p === '/proj/page.html'),
  readFileSync: vi.fn()
}))

vi.mock('../../html-lib/utils', async (orig) => {
  const mod = (await orig()) as any
  return {
    ...(mod as Record<string, any>),
    getAssetsFromHtml: vi.fn(() => ({
      js: [
        'https://cdn.example.com/lib.js',
        '//cdn.example.com/also.js',
        '/public/ignore-public.js',
        '/proj/local.js'
      ],
      css: [
        'https://cdn.example.com/a.css',
        '/public/ignore.css',
        '/proj/local.css'
      ],
      static: []
    }))
  }
})

import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'

describe('AddScriptsAndStylesToCompilation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('excludes remote and public-root URLs from entry imports', () => {
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: '/proj/manifest.json',
      includeList: {feature: '/proj/page.html'} as any
    } as any)

    const compiler: any = {
      options: {mode: 'production', entry: {}},
      hooks: {}
    }

    plugin.apply(compiler)

    const e = compiler.options.entry
    expect(e.feature.import).toContain('/proj/local.js')
    expect(e.feature.import).toContain('/proj/local.css')
    expect(
      e.feature.import.some((x: string) => /cdn\.example\.com/.test(x))
    ).toBe(false)
    expect(e.feature.import.some((x: string) => /public\//.test(x))).toBe(false)
  })
})

