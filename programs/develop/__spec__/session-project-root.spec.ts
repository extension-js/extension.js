import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {getDirs} from '../lib/paths'
import {getProjectStructure} from '../lib/project'
import {resolveSessionProjectRoot} from '../lib/session-project-root'

const created: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  created.push(dir)
  return dir
}

function writeManifest(dir: string) {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'ext', version: '1.0.0'})
  )
}

afterEach(() => {
  for (const dir of created) fs.rmSync(dir, {recursive: true, force: true})
  created.length = 0
})

describe('resolveSessionProjectRoot', () => {
  it('maps the manifest folder and the package root to the same root', () => {
    const root = makeTempDir('extjs-session-root-')
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ext"}')
    writeManifest(path.join(root, 'src'))

    expect(resolveSessionProjectRoot(root)).toBe(root)
    expect(resolveSessionProjectRoot(path.join(root, 'src'))).toBe(root)
  })

  it('agrees with the root dev anchors on for every accepted input', async () => {
    const root = makeTempDir('extjs-session-agree-')
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ext"}')
    writeManifest(path.join(root, 'src'))

    for (const input of [root, path.join(root, 'src')]) {
      const structure = await getProjectStructure(input)
      expect(resolveSessionProjectRoot(input)).toBe(
        getDirs(structure).packageJsonDir
      )
    }
  })

  it('stops at the inner package instead of an outer workspace root', () => {
    const outer = makeTempDir('extjs-session-outer-')
    fs.writeFileSync(path.join(outer, 'package.json'), '{"name":"outer"}')
    const inner = path.join(outer, 'packages', 'ext')
    fs.mkdirSync(inner, {recursive: true})
    fs.writeFileSync(path.join(inner, 'package.json'), '{"name":"inner"}')
    writeManifest(path.join(inner, 'src'))

    expect(resolveSessionProjectRoot(path.join(inner, 'src'))).toBe(inner)
  })

  it('keeps a web-only project at the manifest folder', () => {
    const root = makeTempDir('extjs-session-web-')
    writeManifest(path.join(root, 'src'))

    expect(resolveSessionProjectRoot(path.join(root, 'src'))).toBe(
      path.join(root, 'src')
    )
  })

  it('uses a deno.json root when there is no package.json', () => {
    const root = makeTempDir('extjs-session-deno-')
    fs.writeFileSync(path.join(root, 'deno.json'), '{}')
    writeManifest(path.join(root, 'src'))

    expect(resolveSessionProjectRoot(path.join(root, 'src'))).toBe(root)
  })

  it('leaves a folder without a manifest, or a missing path, as given', () => {
    const root = makeTempDir('extjs-session-empty-')
    expect(resolveSessionProjectRoot(root)).toBe(root)
    const missing = path.join(root, 'nope')
    expect(resolveSessionProjectRoot(missing)).toBe(missing)
  })

  it('prints nothing while it walks', () => {
    const root = makeTempDir('extjs-session-quiet-')
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ext"}')
    writeManifest(path.join(root, 'packages', 'one'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(resolveSessionProjectRoot(root)).toBe(root)
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
