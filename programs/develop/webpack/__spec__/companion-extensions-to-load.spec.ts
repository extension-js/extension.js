import {describe, it, expect, afterEach, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {computeExtensionsToLoad} from '../webpack-lib/extensions-to-load'
import {resolveCompanionExtensionDirs} from '../plugin-extension/feature-special-folders/companion-extensions'

const created: string[] = []
const toPosix = (value: string) => value.replace(/\\/g, '/')
function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
})

describe('companion extensions (load-only) are wired into BrowsersPlugin', () => {
  it('includes scanned extensions/<name> (manifest.json) and keeps user extension output last', async () => {
    const root = tmpDir('extjs-companion-wire-')

    // Minimal project structure
    const pkgPath = path.join(root, 'package.json')
    const manifestPath = path.join(root, 'manifest.json')
    fs.writeFileSync(pkgPath, JSON.stringify({name: 'x'}), 'utf-8')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, name: 'x', version: '0.0.0'}),
      'utf-8'
    )

    // Companion unpacked extension root under ./extensions/other/manifest.json
    const companionRoot = path.join(root, 'extensions', 'other')
    fs.mkdirSync(companionRoot, {recursive: true})
    fs.writeFileSync(
      path.join(companionRoot, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'other', version: '0.0.0'}),
      'utf-8'
    )

    const companionDirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {dir: './extensions'}
    })
    const userOut = path.resolve(root, 'dist', 'chrome')
    const extList = computeExtensionsToLoad(
      path.resolve(__dirname, '..'),
      'development',
      'chrome',
      userOut,
      companionDirs
    )

    const normalizePath = (value: string) =>
      toPosix(value).replace(/\/+$/, '').toLowerCase()
    const normalized = extList.map((value: string) => normalizePath(value))
    const userSuffix = normalizePath(path.join('dist', 'chrome'))
    const companionSuffix = normalizePath(path.join('extensions', 'other'))
    const companionIndex = normalized.findIndex((p) =>
      p.endsWith(companionSuffix)
    )
    const userIndex = normalized.findIndex((p) => p.endsWith(userSuffix))
    expect(companionIndex).toBeGreaterThanOrEqual(0)
    expect(normalized[normalized.length - 1].endsWith(userSuffix)).toBe(true)
    expect(companionIndex).toBeLessThan(userIndex)
  })
})
