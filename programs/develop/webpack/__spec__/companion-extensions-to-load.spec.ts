import {describe, it, expect, afterEach, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {computeExtensionsToLoad} from '../webpack-lib/extensions-to-load'
import {resolveCompanionExtensionDirs} from '../feature-special-folders/folder-extensions/companion-extensions'

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

  it('does not load built-in devtools when both built-in and user define new tab override', () => {
    const root = tmpDir('extjs-devtools-ntp-guard-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'user/newtab.html'}
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'pages/newtab.html'}
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      []
    )
    expect(list).toEqual([userOut])
  })

  it('loads built-in devtools to provide blank new tab when user has no new tab override', () => {
    const root = tmpDir('extjs-devtools-ntp-default-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'pages/newtab.html'}
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      root,
      'production',
      'chrome',
      userOut,
      []
    )
    expect(list).toEqual([devtoolsForBrowser, userOut])
  })

  it('falls back to monorepo extensions/*/dist when programs/develop/dist is absent', () => {
    const root = tmpDir('extjs-devtools-fallback-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const fallbackDevtoolsForBrowser = path.join(
      root,
      'extensions',
      'extension-js-devtools',
      'dist',
      'chrome'
    )
    const fallbackThemeForBrowser = path.join(
      root,
      'extensions',
      'extension-js-theme',
      'dist',
      'chrome'
    )
    fs.mkdirSync(fallbackDevtoolsForBrowser, {recursive: true})
    fs.mkdirSync(fallbackThemeForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(fallbackDevtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js DevTools',
        version: '0.0.0'
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(fallbackThemeForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      path.join(root, 'programs', 'develop'),
      'production',
      'chrome',
      userOut,
      []
    )

    expect(list).toEqual([
      path.resolve(fallbackDevtoolsForBrowser),
      path.resolve(fallbackThemeForBrowser),
      userOut
    ])
  })

  it('always includes built-in devtools + theme before user extension when available', () => {
    const root = tmpDir('extjs-builtins-always-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    const themeForBrowser = path.join(
      root,
      'dist',
      'extension-js-theme',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.mkdirSync(themeForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js DevTools',
        version: '0.0.0'
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(themeForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    for (const mode of ['development', 'production'] as const) {
      const list = computeExtensionsToLoad(root, mode, 'chrome', userOut, [])
      expect(list).toEqual([devtoolsForBrowser, themeForBrowser, userOut])
    }
  })

  it('skips built-in devtools when user source manifest defines newtab but output manifest is not built yet', () => {
    const root = tmpDir('extjs-devtools-source-manifest-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    // Intentionally do not write dist/chrome/manifest.json to simulate startup race.

    const sourceManifestPath = path.join(root, 'manifest.json')
    fs.writeFileSync(
      sourceManifestPath,
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'user/newtab.html'}
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    const themeForBrowser = path.join(
      root,
      'dist',
      'extension-js-theme',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.mkdirSync(themeForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'pages/newtab.html'}
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(themeForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      [],
      sourceManifestPath
    )
    expect(list).toEqual([themeForBrowser, userOut])
  })
})
