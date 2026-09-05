import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Firefox chrome_settings_overrides: addresses stay addresses, packaged
// files ship where the built manifest names them.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'h6FO1AAAAABJRU5ErkJggg==',
  'base64'
)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-settings-ovr-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'settings', version: '0.0.0'})
  )
  fs.mkdirSync(path.join(root, 'icons'))
  fs.mkdirSync(path.join(root, 'pages'))
  fs.writeFileSync(path.join(root, 'icons', 'fav.png'), PNG)
  fs.writeFileSync(
    path.join(root, 'pages', 'start.html'),
    '<!doctype html><title>start</title>'
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 2,
      name: 'Settings',
      version: '1.0.0',
      chrome_settings_overrides: {
        homepage: 'https://example.com/',
        startup_pages: ['https://example.com/start', 'pages/start.html'],
        search_provider: {
          name: 'X',
          search_url: 'https://x.example/?q={searchTerms}',
          favicon_url: 'icons/fav.png',
          is_default: false
        }
      }
    })
  )
  return root
}

describe('chrome_settings_overrides', () => {
  it('keeps addresses verbatim and ships every packaged file it names', async () => {
    const root = project()
    const {extensionBuild} = await import('../command-build')
    const previous = process.env.VITEST
    process.env.VITEST = 'true'
    try {
      const summary = await extensionBuild(root, {
        browser: 'firefox',
        silent: true,
        install: false,
        mode: 'production',
        exitOnError: false
      } as any)
      expect(summary.errors_count).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }
    const distDir = path.join(root, 'dist', 'firefox')
    const built = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
    const overrides = built.chrome_settings_overrides
    expect(overrides.homepage).toBe('https://example.com/')
    expect(overrides.search_provider.search_url).toBe(
      'https://x.example/?q={searchTerms}'
    )
    expect(overrides.startup_pages[0]).toBe('https://example.com/start')
    expect(overrides.startup_pages[1]).toBe(
      'chrome_settings_overrides/startup-1.html'
    )
    expect(fs.existsSync(path.join(distDir, overrides.startup_pages[1]))).toBe(
      true
    )
    expect(overrides.search_provider.favicon_url).toBe(
      'chrome_settings_overrides/fav.png'
    )
    expect(
      fs.existsSync(path.join(distDir, overrides.search_provider.favicon_url))
    ).toBe(true)
  }, 120_000)
})
