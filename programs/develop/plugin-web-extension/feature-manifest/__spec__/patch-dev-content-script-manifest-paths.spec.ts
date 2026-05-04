import {Compilation} from '@rspack/core'
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {patchDevContentScriptManifestPaths} from '../steps/patch-dev-content-script-manifest-paths'

// Regression for the 3.14 → 3.15 content-script CSS purge gap. Dev mode runs
// with `output.clean: false`. The prior purge regex matched only canonical
// `content-N.<hash>.<ext>` bundles, so named CSS chunks like
// `content-index.<hash>.css` (emitted by content-script CSS imports via
// `import.meta.url`) accumulated in the output directory across rebuilds.
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
    } catch {}
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
})
