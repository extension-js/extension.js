import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {patchDevContentScriptManifestPaths} from '../steps/patch-dev-content-script-manifest-paths'

describe('patchDevContentScriptManifestPaths: stale CSS chunk purge', () => {
  let tmpRoot: string
  let outputPath: string
  let csDir: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-stale-'))
    outputPath = path.join(tmpRoot, 'dist', 'chromium')
    csDir = path.join(outputPath, 'content_scripts')
    fs.mkdirSync(csDir, {recursive: true})
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function makeCompilation(emittedNames: string[]) {
    const sources = Object.fromEntries(
      emittedNames.map((name) => [name, {source: () => `/* ${name} */`} as any])
    )
    return {
      getAssets: () =>
        emittedNames.map((name) => ({name, source: sources[name]})),
      assets: sources,
      options: {mode: 'development', output: {path: outputPath}}
    } as unknown as Compilation
  }

  it('deletes leftover content-index.<hash>.css not emitted by the current compilation', () => {
    const stale = 'content-index.aaaaaaaa.css'
    const fresh = 'content-index.bbbbbbbb.css'
    fs.writeFileSync(path.join(csDir, stale), '/* stale */')
    fs.writeFileSync(path.join(csDir, fresh), '/* fresh */')

    const manifest: any = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
      ]
    }

    patchDevContentScriptManifestPaths(
      makeCompilation([
        'content_scripts/content-0.cccccccc.js',
        `content_scripts/${fresh}`
      ]),
      manifest
    )

    expect(fs.existsSync(path.join(csDir, stale))).toBe(false)
    expect(fs.existsSync(path.join(csDir, fresh))).toBe(true)
  })

  it('does not delete files lacking a hash suffix (user-placed static assets)', () => {
    const userFile = 'static-thing.txt'
    const plainCss = 'index.css'
    fs.writeFileSync(path.join(csDir, userFile), 'plain')
    fs.writeFileSync(path.join(csDir, plainCss), '/* plain */')

    const manifest: any = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
      ]
    }

    patchDevContentScriptManifestPaths(
      makeCompilation(['content_scripts/content-0.cccccccc.js']),
      manifest
    )

    expect(fs.existsSync(path.join(csDir, userFile))).toBe(true)
    expect(fs.existsSync(path.join(csDir, plainCss))).toBe(true)
  })

  it('rewrites both content_scripts entries with their per-entry hashed names and purges stale bundles', () => {
    const stale0 = 'content-0.aaaaaaaa.js'
    const stale1 = 'content-1.aaaaaaaa.js'
    const fresh0 = 'content-0.bbbbbbbb.js'
    const fresh1 = 'content-1.cccccccc.js'

    fs.writeFileSync(path.join(csDir, stale0), '/* stale 0 */')
    fs.writeFileSync(path.join(csDir, stale1), '/* stale 1 */')
    fs.writeFileSync(path.join(csDir, fresh0), '/* fresh 0 */')
    fs.writeFileSync(path.join(csDir, fresh1), '/* fresh 1 */')

    const manifest: any = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']},
        {matches: ['<all_urls>'], js: ['content_scripts/content-1.js']}
      ]
    }

    const result = patchDevContentScriptManifestPaths(
      makeCompilation([
        `content_scripts/${fresh0}`,
        `content_scripts/${fresh1}`
      ]),
      manifest
    )

    expect(result.content_scripts?.[0]?.js).toEqual([
      `content_scripts/${fresh0}`
    ])
    expect(result.content_scripts?.[1]?.js).toEqual([
      `content_scripts/${fresh1}`
    ])
    expect(fs.existsSync(path.join(csDir, stale0))).toBe(false)
    expect(fs.existsSync(path.join(csDir, stale1))).toBe(false)
    expect(fs.existsSync(path.join(csDir, fresh0))).toBe(true)
    expect(fs.existsSync(path.join(csDir, fresh1))).toBe(true)
  })
})
