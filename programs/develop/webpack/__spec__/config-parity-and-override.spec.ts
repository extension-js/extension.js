import {describe, it, expect, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {
  loadCustomWebpackConfig,
  loadCommandConfig,
  loadBrowserConfig
} from '../webpack-lib/config-loader'

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

describe('extension.config object-merge and command/browser defaults', () => {
  it('merges plain object config on top of base using deep merge', async () => {
    const dir = tmpDir('extjs-cfg-')
    const cfg = `export default { config: { resolve: { alias: { foo: 'bar' } } } }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    const hook = await loadCustomWebpackConfig(dir)
    const base = {resolve: {alias: {baz: 'qux'}}}
    const merged = hook(base as any) as any
    expect(merged.resolve.alias).toMatchObject({baz: 'qux', foo: 'bar'})
  })

  it('returns command defaults for build/preview/start and browser defaults', async () => {
    const dir = tmpDir('extjs-cmd-')
    const cfg = `export default {
      commands: {
        build: { zip: true },
        start: { polyfill: true, profile: 'user' },
        preview: { profile: 'user' }
      },
      browser: {
        chrome: {
          browser: 'chrome',
          browserFlags: ['--headless=new'],
          preferences: { a: 1 },
          persistProfile: true
        },
        'chromium-based': {
          browser: 'chromium-based',
          browserFlags: ['--foo'],
          preferences: { b: 2 },
          persistProfile: true,
          profile: './dist/chromium-profile'
        }
      }
    }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    const buildCfg = await loadCommandConfig(dir, 'build')
    expect(buildCfg).toMatchObject({zip: true})

    const startCfg = await loadCommandConfig(dir, 'start')
    expect(startCfg).toMatchObject({polyfill: true, profile: 'user'})

    const previewCfg = await loadCommandConfig(dir, 'preview')
    expect(previewCfg).toMatchObject({profile: 'user'})

    const browserCfg = await loadBrowserConfig(dir, 'chrome')
    expect(browserCfg).toMatchObject({
      browser: 'chrome',
      browserFlags: ['--headless=new'],
      preferences: {a: 1},
      persistProfile: true
    })

    // Engine-based selection should use the chromium-based section,
    // while managed Chromium ('chromium') remains independent.
    const chromiumBasedCfg = await loadBrowserConfig(dir, 'chromium-based')
    expect(chromiumBasedCfg).toMatchObject({
      browser: 'chromium-based',
      browserFlags: ['--foo'],
      preferences: {b: 2},
      persistProfile: true,
      profile: './dist/chromium-profile'
    })

    const chromiumCfg = await loadBrowserConfig(dir, 'chromium')
    expect(chromiumCfg).toMatchObject({browser: 'chromium'})
  })

  it('merges top-level extensions into command config and allows per-command overrides', async () => {
    const dir = tmpDir('extjs-exts-')
    const cfg = `export default {
      extensions: { dir: './extensions' },
      commands: {
        dev: { extensions: ['./explicit-a', './explicit-b'] },
        preview: { profile: 'user' }
      }
    }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    // When command has its own extensions, it should override top-level extensions
    const devCfg = await loadCommandConfig(dir, 'dev')
    expect(devCfg).toMatchObject({
      extensions: ['./explicit-a', './explicit-b']
    })

    // When command has no extensions, it should inherit top-level extensions
    const startCfg = await loadCommandConfig(dir, 'start')
    expect(startCfg).toMatchObject({
      extensions: {dir: './extensions'}
    })

    // Ensure command keys still work alongside inherited extensions
    const previewCfg = await loadCommandConfig(dir, 'preview')
    expect(previewCfg).toMatchObject({
      profile: 'user',
      extensions: {dir: './extensions'}
    })
  })
})
