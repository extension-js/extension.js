import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {loadBrowserConfig} from '../config-loader'

describe('config-loader', () => {
  it('loadBrowserConfig returns defaults when no config present', async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-'))
    const cfg = await loadBrowserConfig(dir, 'chrome')
    expect(cfg.browser).toBe('chrome')
  })
})
