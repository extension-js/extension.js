import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomConfig,
  loadProjectConfigDefaults
} from '../lib/config-loader'
import {mergeOptionLayers} from '../lib/merge-options'

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
    } catch {
      // Ignore
    }
  }
  created.length = 0
})

describe('extension.config object-merge and command/browser defaults', () => {
  it('merges plain object config on top of base using deep merge', async () => {
    const dir = tmpDir('extjs-cfg-')
    const cfg = `export default { config: { resolve: { alias: { foo: 'bar' } } } }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    const hook = await loadCustomConfig(dir)
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

  it('adopts product browser blocks for engine-based families', async () => {
    const dir = tmpDir('extjs-family-')
    const cfg = `export default {
      browser: {
        chromium: {
          browser: 'chromium',
          browserFlags: ['--chromium-flag']
        },
        firefox: {
          browser: 'firefox',
          browserFlags: ['--firefox-flag']
        },
        safari: {
          browser: 'safari',
          appName: 'MySafariApp',
          bundleId: 'com.example.mysafariapp',
          safariBinary: '/Applications/Safari.app'
        }
      }
    }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    const chromiumBasedCfg = await loadBrowserConfig(dir, 'chromium-based')
    expect(chromiumBasedCfg).toMatchObject({
      browser: 'chromium',
      browserFlags: ['--chromium-flag']
    })

    const geckoBasedCfg = await loadBrowserConfig(dir, 'gecko-based')
    expect(geckoBasedCfg).toMatchObject({
      browser: 'firefox',
      browserFlags: ['--firefox-flag']
    })

    // webkit-based must adopt browser.safari the same way the other families do
    const webkitBasedCfg = await loadBrowserConfig(dir, 'webkit-based')
    expect(webkitBasedCfg).toMatchObject({
      browser: 'safari',
      appName: 'MySafariApp',
      bundleId: 'com.example.mysafariapp',
      safariBinary: '/Applications/Safari.app'
    })
  })

  it('prefers an explicit webkit-based block over browser.safari', async () => {
    const dir = tmpDir('extjs-webkit-prefer-')
    const cfg = `export default {
      browser: {
        safari: {
          browser: 'safari',
          appName: 'FromSafari'
        },
        'webkit-based': {
          browser: 'webkit-based',
          appName: 'FromWebkitBased'
        }
      }
    }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    const webkitBasedCfg = await loadBrowserConfig(dir, 'webkit-based')
    expect(webkitBasedCfg).toMatchObject({
      browser: 'webkit-based',
      appName: 'FromWebkitBased'
    })
  })

  it('adopts safari/webkit-based config for any webkit-flavored fork name', async () => {
    const withExact = tmpDir('extjs-webkit-fork-exact-')
    fs.writeFileSync(
      path.join(withExact, 'extension.config.mjs'),
      `export default {
        browser: {
          safari: { browser: 'safari', appName: 'FromSafari' },
          'webkit-based': { browser: 'webkit-based', appName: 'FromWebkitBased' },
          'acme-webkit': { browser: 'acme-webkit', appName: 'FromAcme' }
        }
      }`,
      'utf-8'
    )
    // Exact fork block wins when present.
    const exact = await loadBrowserConfig(withExact, 'acme-webkit' as any)
    expect(exact).toMatchObject({browser: 'acme-webkit', appName: 'FromAcme'})

    // Prefer webkit-based over safari when both exist and the fork has no block.
    const withEngine = tmpDir('extjs-webkit-fork-engine-')
    fs.writeFileSync(
      path.join(withEngine, 'extension.config.mjs'),
      `export default {
        browser: {
          safari: { browser: 'safari', appName: 'FromSafari' },
          'webkit-based': { browser: 'webkit-based', appName: 'FromWebkitBased' }
        }
      }`,
      'utf-8'
    )
    const engineCfg = await loadBrowserConfig(
      withEngine,
      'internal-webkit' as any
    )
    expect(engineCfg).toMatchObject({
      browser: 'webkit-based',
      appName: 'FromWebkitBased'
    })

    // Fall all the way back to browser.safari when only the product block exists.
    const safariOnly = tmpDir('extjs-webkit-fork-safari-')
    fs.writeFileSync(
      path.join(safariOnly, 'extension.config.mjs'),
      `export default {
        browser: {
          safari: { browser: 'safari', appName: 'FromSafariOnly' }
        }
      }`,
      'utf-8'
    )
    const forkCfg = await loadBrowserConfig(
      safariOnly,
      'internal-webkit' as any
    )
    expect(forkCfg).toMatchObject({
      browser: 'safari',
      appName: 'FromSafariOnly'
    })
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

    // The top-level value is its own (weakest) layer; a command layer only
    // carries what commands.<cmd> sets, so browser.<vendor> can outrank it.
    const projectCfg = await loadProjectConfigDefaults(dir)
    expect(projectCfg).toEqual({extensions: {dir: './extensions'}})

    const devCfg = await loadCommandConfig(dir, 'dev')
    expect(devCfg).toMatchObject({
      extensions: ['./explicit-a', './explicit-b']
    })

    const startCfg = await loadCommandConfig(dir, 'start')
    expect(startCfg).toEqual({})

    const previewCfg = await loadCommandConfig(dir, 'preview')
    expect(previewCfg).toEqual({profile: 'user'})
    expect(
      mergeOptionLayers(
        {},
        projectCfg,
        {extensions: {dir: './from-browser'}},
        previewCfg
      )
    ).toMatchObject({extensions: {dir: './from-browser'}})
  })

  it('merges top-level transpilePackages and allows per-command overrides', async () => {
    const dir = tmpDir('extjs-transpile-')
    const cfg = `export default {
      transpilePackages: ['@workspace/ui'],
      commands: {
        build: { transpilePackages: ['@workspace/ui', '@workspace/icons'] }
      }
    }`
    fs.writeFileSync(path.join(dir, 'extension.config.mjs'), cfg, 'utf-8')

    const projectCfg = await loadProjectConfigDefaults(dir)
    expect(projectCfg).toEqual({transpilePackages: ['@workspace/ui']})

    const devCfg = await loadCommandConfig(dir, 'dev')
    expect(devCfg).toEqual({})

    const buildCfg = await loadCommandConfig(dir, 'build')
    expect(buildCfg).toMatchObject({
      transpilePackages: ['@workspace/ui', '@workspace/icons']
    })
    expect(
      mergeOptionLayers(
        {},
        projectCfg,
        {transpilePackages: ['@workspace/from-browser']},
        devCfg
      )
    ).toMatchObject({transpilePackages: ['@workspace/from-browser']})
  })
})
