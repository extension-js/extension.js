import {describe, it, expect, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {
  loadCustomWebpackConfig,
  loadCommandConfig,
  loadBrowserConfig,
  isUsingExperimentalConfig
} from '../config-loader'

const created: string[] = []
function makeTempDir(prefix: string) {
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

describe('get-extension-config defaults', () => {
  it('returns identity config when no user config exists', async () => {
    const tmp = makeTempDir('extjs-config-')
    const identity = await loadCustomWebpackConfig(tmp)
    const obj = {a: 1}
    expect(identity(obj as any)).toEqual(obj)
    expect(await loadCommandConfig(tmp, 'dev')).toEqual({})
    const browser = await loadBrowserConfig(tmp, 'chrome')
    expect(browser.browser).toBe('chrome')
    expect(await isUsingExperimentalConfig(tmp)).toBe(false)
  })
})

