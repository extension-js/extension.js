import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  resolveLoaderConfigPath,
  loadLoaderOptions
} from '../load-loader-options'
import * as messages from '../messages'

describe('load-loader-options', () => {
  const originalEnv = process.env.EXTENSION_ENV
  let tmpDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-loaders-'))
  })

  afterEach(() => {
    process.env.EXTENSION_ENV = originalEnv
    try {
      fs.rmSync(tmpDir, {recursive: true, force: true})
    } catch {}
  })

  it('prefers .ts over other extensions when present (pure resolver test)', () => {
    const ts = path.join(tmpDir, 'svelte.loader.ts')
    fs.writeFileSync(ts, 'export default {}\n')

    const resolved = resolveLoaderConfigPath(tmpDir, 'svelte')
    expect(resolved).toBe(ts)
  })

  it('falls back in order: .mts -> .js -> .mjs (pure resolver test)', () => {
    const mts = path.join(tmpDir, 'svelte.loader.mts')
    const js = path.join(tmpDir, 'svelte.loader.js')
    const mjs = path.join(tmpDir, 'svelte.loader.mjs')
    fs.writeFileSync(mts, 'export default {}\n')
    fs.writeFileSync(js, 'module.exports = {}\n')
    fs.writeFileSync(mjs, 'export default {}\n')

    const resolved = resolveLoaderConfigPath(tmpDir, 'svelte')
    expect(path.basename(resolved || '')).toBe('svelte.loader.mts')
  })

  it('logs dev-only message once and loads module when config exists', async () => {
    process.env.EXTENSION_ENV = 'development'

    // Create a real importable module (.mjs) to avoid ts transpilation complexity
    const mjsPath = path.join(tmpDir, 'svelte.loader.mjs')
    fs.writeFileSync(mjsPath, 'export default { custom: true }\n')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const first = await loadLoaderOptions(tmpDir, 'svelte')
    expect(first).toEqual({custom: true})

    // Logged once with correct message
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(
      messages.isUsingCustomLoader('svelte.loader.mjs')
    )

    // Call again: should not log again
    const second = await loadLoaderOptions(tmpDir, 'svelte')
    expect(second).toEqual({custom: true})
    expect(logSpy).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it("doesn't log outside development", async () => {
    process.env.EXTENSION_ENV = 'test'

    const mjsPath = path.join(tmpDir, 'vue.loader.mjs')
    fs.writeFileSync(mjsPath, 'export default { ok: true }\n')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const loaded = await loadLoaderOptions(tmpDir, 'vue')
    expect(loaded).toEqual({ok: true})
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })
})
