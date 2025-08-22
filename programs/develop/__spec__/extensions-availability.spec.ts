import * as fs from 'fs'
import * as path from 'path'

describe('manager extension assets availability', () => {
  function getExtensionsDir(): string {
    // Resolve package entry point, then point to its sibling extensions dir
    const entryPath = require.resolve('extension-develop')
    const distDir = path.dirname(entryPath)
    return path.join(distDir, 'extensions')
  }

  it('dist/extensions exists with chrome manager extension manifest', () => {
    const extensionsDir = getExtensionsDir()
    expect(fs.existsSync(extensionsDir)).toBe(true)

    const chromeManifest = path.join(
      extensionsDir,
      'chrome-manager-extension',
      'manifest.json'
    )
    expect(fs.existsSync(chromeManifest)).toBe(true)
  })

  it('all manager variants are present (chrome, chromium-based, edge, firefox, gecko-based)', () => {
    const base = getExtensionsDir()
    const expected = [
      'chrome-manager-extension',
      'chromium-based-manager-extension',
      'edge-manager-extension',
      'firefox-manager-extension',
      'gecko-based-manager-extension'
    ]
    for (const dir of expected) {
      const p = path.join(base, dir, 'manifest.json')
      expect(fs.existsSync(p)).toBe(true)
    }
  })
})
