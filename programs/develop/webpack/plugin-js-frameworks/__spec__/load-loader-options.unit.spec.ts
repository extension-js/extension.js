import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import {loadLoaderOptions} from '../load-loader-options'

describe('load-loader-options', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when no custom loader files exist', async () => {
    const fs = require('fs') as any
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const res = await loadLoaderOptions('/p', 'vue')
    expect(res).toBeNull()
  })

  it('loads .mjs or .js file and returns default export if present', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llo-spec-'))
    const file = path.join(tmp, 'vue.loader.mjs')
    // create a real module file
    fs.writeFileSync(file, 'export default { ok: true }', 'utf8')
    const res = await loadLoaderOptions(tmp, 'vue')
    expect(res).toEqual({ok: true})
  })

  it('rethrows on import error and logs message', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llo-spec-err-'))
    const file = path.join(tmp, 'svelte.loader.mjs')
    fs.writeFileSync(file, 'throw new Error("boom")', 'utf8')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(loadLoaderOptions(tmp, 'svelte')).rejects.toThrow('boom')
    expect(spy).toHaveBeenCalled()
  })
})
