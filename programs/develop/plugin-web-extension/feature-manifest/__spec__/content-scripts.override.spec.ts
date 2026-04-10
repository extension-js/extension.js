import {describe, expect, it} from 'vitest'
import {contentScripts} from '../manifest-overrides/common/content_scripts'

describe('manifest content_scripts override', () => {
  it('de-duplicates emitted js/css bundle paths per content script group', () => {
    const manifest = {
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: [
            'src/content_scripts/a.ts',
            'src/content_scripts/b.ts',
            'src/content_scripts/c.ts'
          ],
          css: ['src/content_scripts/a.css', 'src/content_scripts/b.css']
        }
      ]
    } as any

    const patched = contentScripts(manifest)
    const first = patched?.content_scripts?.[0]

    expect(first?.js).toEqual(['content_scripts/content-0.js'])
    expect(first?.css).toEqual(['content_scripts/content-0.css'])
  })

  it('is idempotent for already bundled MAIN-world content scripts', () => {
    const oncePatched = {
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-0.js'],
          css: []
        },
        {
          matches: ['https://example.com/*'],
          js: ['content_scripts/content-2.js'],
          css: []
        },
        {
          matches: ['https://example.com/*'],
          world: 'MAIN',
          js: ['content_scripts/content-1.js'],
          css: []
        }
      ]
    } as any

    const twicePatched = contentScripts(oncePatched)

    expect(twicePatched?.content_scripts).toEqual(oncePatched.content_scripts)
  })
})
