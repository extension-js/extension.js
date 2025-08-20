import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {ThrowIfRecompileIsNeeded} from '../steps/throw-if-recompile'
import * as path from 'path'
import {sources} from '@rspack/core'

describe('ThrowIfRecompileIsNeeded', () => {
  const originalKill = process.kill
  const originalWarn = console.warn

  beforeEach(() => {
    // @ts-expect-error - test override
    process.kill = vi.fn()
    // @ts-expect-error - test override
    console.warn = vi.fn()
  })

  afterEach(() => {
    // @ts-expect-error - restore
    process.kill = originalKill
    console.warn = originalWarn
  })

  it('warns and attempts to restart when entrypoints change', async () => {
    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'examples',
        'content',
        'manifest.json'
      ),
      browser: 'chrome'
    } as any)

    // initial manifest
    const fs = require('fs') as typeof import('fs')
    vi.spyOn(fs, 'existsSync').mockImplementation((p: string) => true)
    vi.spyOn(fs, 'readFileSync').mockImplementation((p: string, enc: any) => {
      if (typeof p === 'string' && p.endsWith('package.json')) {
        return JSON.stringify({name: 'test'})
      }
      // manifest read
      return JSON.stringify({
        name: 'x',
        manifest_version: 3,
        content_scripts: [{matches: ['<all_urls>'], js: ['a.js'], css: []}]
      })
    })

    const compilation: any = {
      hooks: {
        processAssets: {
          tap: (_: any, cb: Function) => {
            // updated manifest asset with changed content_scripts
            const updated = new sources.RawSource(
              JSON.stringify(
                {
                  name: 'x',
                  manifest_version: 3,
                  content_scripts: [
                    {matches: ['<all_urls>'], js: ['b.js'], css: []}
                  ]
                },
                null,
                2
              )
            )
            compilation.getAsset = () => ({source: updated})
            cb()
          }
        }
      }
    }

    const compiler: any = {
      options: {context: process.cwd()},
      modifiedFiles: new Set([plugin['manifestPath']]),
      hooks: {
        watchRun: {
          tapAsync: (_: string, cb: Function) => cb(compiler, () => {})
        },
        thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
      }
    }

    plugin.apply(compiler)

    // allow timers to run
    await new Promise((r) => setTimeout(r, 150))

    expect(console.warn).toHaveBeenCalled()
    expect(process.kill).toHaveBeenCalled()
  })
})
