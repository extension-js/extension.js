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
  })
})
