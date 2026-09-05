import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Development content-script bundles carry a per-entry content hash, so a
// save must rename only the script it touched, the manifest on disk must
// only ever name files that exist beside it, and a compile error must leave
// the last working extension in place. Real builds, no browser.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cs-hash-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'cs-hash', version: '0.0.0'})
  )
  fs.writeFileSync(path.join(root, 'content-a.js'), 'console.log("a v1")\n')
  fs.writeFileSync(path.join(root, 'content-b.js'), 'console.log("b v1")\n')
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'cs-hash',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['https://a.example/*'], js: ['content-a.js']},
        {matches: ['https://b.example/*'], js: ['content-b.js']}
      ]
    })
  )
  return root
}

async function build(root: string, extra: Record<string, unknown> = {}) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'development',
      zip: false,
      exitOnError: false,
      ...extra
    } as any)
    return summary
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function readDist(root: string) {
  const distDir = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const named: string[] = (manifest.content_scripts || []).flatMap(
    (group: {js?: string[]}) => group.js || []
  )
  const missing = named.filter(
    (file) => !fs.existsSync(path.join(distDir, file))
  )
  return {distDir, manifest, named, missing}
}

const HASHED = /^content_scripts\/content-(\d+)\.([a-f0-9]{8})\.js$/

describe('development content-script hashing across rebuilds', () => {
  it('renames only the touched script, never names a missing file, and survives a broken pass', async () => {
    const root = project()

    expect((await build(root)).errors_count).toBe(0)
    const first = readDist(root)
    expect(first.missing).toEqual([])
    expect(first.named).toHaveLength(2)
    expect(first.named[0]).toMatch(HASHED)
    expect(first.named[1]).toMatch(HASHED)
    expect(
      fs.existsSync(path.join(first.distDir, 'background', 'service_worker.js'))
    ).toBe(true)

    fs.writeFileSync(path.join(root, 'content-b.js'), 'console.log("b v2")\n')
    expect((await build(root)).errors_count).toBe(0)
    const second = readDist(root)
    expect(second.missing).toEqual([])
    expect(second.named[0]).toBe(first.named[0])
    expect(second.named[1]).not.toBe(first.named[1])
    expect(second.named[1]).toMatch(HASHED)

    // A compile error must leave the last working extension untouched: the
    // failed pass rejects and its staging output is discarded.
    fs.writeFileSync(path.join(root, 'content-b.js'), 'console.log("b v3"\n')
    await expect(build(root)).rejects.toThrow('Build failed with errors')
    const afterBroken = readDist(root)
    expect(afterBroken.manifest).toEqual(second.manifest)
    expect(afterBroken.missing).toEqual([])
  }, 300_000)

  it('hashContentScripts: false gives plain names the manifest points at', async () => {
    const root = project()
    expect((await build(root, {hashContentScripts: false})).errors_count).toBe(
      0
    )
    const dist = readDist(root)
    expect(dist.named).toEqual([
      'content_scripts/content-0.js',
      'content_scripts/content-1.js'
    ])
    expect(dist.missing).toEqual([])
  }, 180_000)
})
