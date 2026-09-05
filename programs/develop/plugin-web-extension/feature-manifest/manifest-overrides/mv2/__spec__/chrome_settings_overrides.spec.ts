import {describe, expect, it} from 'vitest'
import {chromeSettingsOverrides} from '../chrome_settings_overrides'

describe('chrome_settings_overrides override', () => {
  it('keeps every address verbatim', () => {
    const out = chromeSettingsOverrides({
      chrome_settings_overrides: {
        homepage: 'https://example.com/',
        startup_pages: ['https://example.com/start', 'about:blank'],
        search_provider: {
          name: 'X',
          search_url: 'https://x.example/?q={searchTerms}',
          favicon_url: '//cdn.example/fav.png'
        }
      }
    } as any) as any
    expect(out.chrome_settings_overrides).toEqual({
      homepage: 'https://example.com/',
      startup_pages: ['https://example.com/start', 'about:blank'],
      search_provider: {
        name: 'X',
        search_url: 'https://x.example/?q={searchTerms}',
        favicon_url: '//cdn.example/fav.png'
      }
    })
  })

  it('names packaged files where the emitters put them', () => {
    const out = chromeSettingsOverrides({
      chrome_settings_overrides: {
        startup_pages: ['pages/start.html'],
        search_provider: {name: 'X', favicon_url: 'icons/fav.png'}
      }
    } as any) as any
    expect(out.chrome_settings_overrides.startup_pages).toEqual([
      'chrome_settings_overrides/startup-0.html'
    ])
    expect(out.chrome_settings_overrides.search_provider.favicon_url).toBe(
      'chrome_settings_overrides/fav.png'
    )
  })
})
