import {describe, it, expect, afterEach, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'

// IMPORTANT:
// `plugin-browsers` currently pulls in heavy runner dependencies that can fail
// to load under certain test environments (see existing suite failures).
// For this integration test, we only need to assert that webpack-config passes
// the correct `extension` list into BrowsersPlugin, so we mock it and capture
// constructor options.
vi.mock('../plugin-browsers', () => {
  class BrowsersPlugin {
    public readonly extension: any
    constructor(options: any) {
      ;(globalThis as any).__EXTJS_BROWSERS_PLUGIN_OPTS__ = options
      this.extension = options?.extension
    }
    apply() {}
  }
  return {BrowsersPlugin}
})

const created: string[] = []
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

    const {default: webpackConfig} = await import('../webpack-config')
    webpackConfig(
      {manifestPath, packageJsonPath: pkgPath} as any,
      {
        browser: 'chrome',
        mode: 'development',
        output: {clean: false, path: 'dist/chrome'},
        extensions: {dir: './extensions'}
      } as any
    )

    const opts = (globalThis as any).__EXTJS_BROWSERS_PLUGIN_OPTS__
    expect(opts).toBeTruthy()
    const extList = Array.isArray(opts.extension)
      ? opts.extension
      : [opts.extension]

    const userOut = path.join(root, 'dist', 'chrome')
    expect(extList.includes(companionRoot)).toBe(true)
    expect(extList[extList.length - 1]).toBe(userOut)
    expect(extList.indexOf(companionRoot)).toBeLessThan(
      extList.indexOf(userOut)
    )
  })
})

