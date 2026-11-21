import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {Manifest} from '../../types'
import {
  devContentScriptManifest,
  patchDevContentScriptManifestPaths
} from '../reload-lib/dev-manifest/content-script-paths'

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

  // A compilation whose compiler keeps its done taps, so a spec can end
  // the build by hand the way the bundler does once the files are written.
  function makeCompilation(emittedNames: string[], errors: unknown[] = []) {
    const sources = Object.fromEntries(
      emittedNames.map((name) => [name, {source: () => `/* ${name} */`}])
    )
    const doneTaps: Array<(stats: {compilation: unknown}) => void> = []
    const compilation = {
      getAssets: () =>
        emittedNames.map((name) => ({name, source: sources[name]})),
      assets: sources,
      errors,
      options: {mode: 'development', output: {path: outputPath}},
      compiler: {
        hooks: {
          done: {
            tap: (_name: string, fn: (typeof doneTaps)[number]) =>
              doneTaps.push(fn)
          }
        }
      }
    }

    return {
      compilation: compilation as unknown as Compilation,
      finish: () => {
        for (const tap of doneTaps) tap({compilation})
      }
    }
  }

  function patchAndFinish(
    emittedNames: string[],
    manifest: Manifest,
    errors: unknown[] = []
  ) {
    const {compilation, finish} = makeCompilation(emittedNames, errors)
    const result = patchDevContentScriptManifestPaths(compilation, manifest)
    finish()

    return result
  }

  it('leaves every file in place while the build is still being put together', () => {
    const stale = 'content-0.aaaaaaaa.js'
    fs.writeFileSync(path.join(csDir, stale), '/* stale */')

    const {compilation, finish} = makeCompilation([
      'content_scripts/content-0.bbbbbbbb.js'
    ])
    patchDevContentScriptManifestPaths(compilation, {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
      ]
    })

    expect(fs.existsSync(path.join(csDir, stale))).toBe(true)

    finish()

    expect(fs.existsSync(path.join(csDir, stale))).toBe(false)
  })

  it('keeps the last build when this one ends with an error', () => {
    const stale = 'content-0.aaaaaaaa.js'
    fs.writeFileSync(path.join(csDir, stale), '/* stale */')

    patchAndFinish(
      ['content_scripts/content-0.bbbbbbbb.js'],
      {
        manifest_version: 3,
        content_scripts: [
          {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
        ]
      },
      [new Error('the build failed')]
    )

    expect(fs.existsSync(path.join(csDir, stale))).toBe(true)
  })

  it('deletes leftover content-index.<hash>.css not emitted by the current compilation', () => {
    const stale = 'content-index.aaaaaaaa.css'
    const fresh = 'content-index.bbbbbbbb.css'
    fs.writeFileSync(path.join(csDir, stale), '/* stale */')
    fs.writeFileSync(path.join(csDir, fresh), '/* fresh */')

    const manifest: Manifest = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
      ]
    }

    patchAndFinish(
      ['content_scripts/content-0.cccccccc.js', `content_scripts/${fresh}`],
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

    const manifest: Manifest = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
      ]
    }

    patchAndFinish(['content_scripts/content-0.cccccccc.js'], manifest)

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

    const manifest: Manifest = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']},
        {matches: ['<all_urls>'], js: ['content_scripts/content-1.js']}
      ]
    }

    const result = patchAndFinish(
      [`content_scripts/${fresh0}`, `content_scripts/${fresh1}`],
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

  it('purges the bundles of the last removed entry when the manifest has no content_scripts', () => {
    const leftovers = [
      'content-0.aaaaaaaa.js',
      'content-0.aaaaaaaa.js.map',
      'content-0.bbbbbbbb.js',
      'content-0.bbbbbbbb.js.map',
      'content-1.cccccccc.css'
    ]

    for (const name of leftovers) {
      fs.writeFileSync(path.join(csDir, name), '/* last-entry-leftover */')
    }

    const manifest: Manifest = {manifest_version: 3, name: 'no-entry-left'}
    const result = patchAndFinish(['background/service_worker.js'], manifest)

    expect(result).toBe(manifest)
    expect(fs.readdirSync(csDir)).toEqual([])
  })

  it('keeps what the current compile emitted and what is no entry bundle when no content script is left', () => {
    const emitted = 'content-0.dddddddd.js'
    const kept = [
      emitted,
      `${emitted}.map`,
      'vendor.0123abcd.js',
      'dev-registry.json',
      'dev-stub-0.js',
      'static-thing.txt'
    ]

    for (const name of kept) {
      fs.writeFileSync(path.join(csDir, name), '/* owned-by-another */')
    }

    fs.writeFileSync(path.join(csDir, 'content-0.eeeeeeee.js'), '/* stale */')

    patchAndFinish([`content_scripts/${emitted}`], {
      manifest_version: 3,
      name: 'no-entry-left'
    })

    expect(fs.readdirSync(csDir).sort()).toEqual([...kept].sort())
  })
})

// What the manifest feature is handed back in a development compile.
describe('devContentScriptManifest', () => {
  const resolved = (emittedNames: string[], manifest: Manifest) =>
    devContentScriptManifest.manifestResolved(
      {
        getAssets: () => emittedNames.map((name) => ({name})),
        errors: [],
        options: {mode: 'development'}
      } as unknown as Compilation,
      manifest
    )

  it('names the script of a group that declares only CSS', () => {
    const out = resolved([], {
      manifest_version: 3,
      content_scripts: [{matches: ['*://*/*'], css: ['a.css']}]
    })

    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.js'
    ])
  })

  it('resolves that script to the hashed file the compile emitted', () => {
    const out = resolved(['content_scripts/content-0.deadbeef.js'], {
      manifest_version: 3,
      content_scripts: [{matches: ['*://*/*'], css: ['a.css']}]
    })

    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.deadbeef.js'
    ])
  })

  it('reads the group index from the canonical CSS path, not the position', () => {
    const out = resolved([], {
      manifest_version: 3,
      content_scripts: [
        {matches: ['*://*/*'], js: ['content_scripts/content-0.js']},
        {matches: ['*://*/*'], css: ['content_scripts/content-3.css']}
      ]
    })

    expect(out.content_scripts?.[1]?.js).toEqual([
      'content_scripts/content-3.js'
    ])
  })
})
