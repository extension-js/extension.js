import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {
  getProjectPath,
  getProjectStructure
} from '../webpack/webpack-lib/project'

const created: string[] = []
function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
})

describe('get-project-path', () => {
  it('resolves relative path to absolute path', async () => {
    const tmp = makeTempDir('extjs-gpp-')
    const rel = 'some/sub/dir'
    const cwd = process.cwd()
    const abs = path.resolve(cwd, rel)
    expect(await getProjectPath(rel)).toBe(abs)
  })

  it('getProjectStructure finds manifest recursively and optional package.json', async () => {
    const root = makeTempDir('extjs-gps-')
    const nested = path.join(root, 'nested', 'deeper')
    fs.mkdirSync(nested, {recursive: true})
    const manifestDir = path.join(nested, 'ext')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), '{}')
    // package.json one level above manifest
    fs.writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const s = await getProjectStructure(root)
    expect(path.basename(s.manifestPath)).toBe('manifest.json')
    expect(s.packageJsonPath && path.basename(s.packageJsonPath)).toBe(
      'package.json'
    )
  })

  it('getProjectStructure allows web-only (no package.json)', async () => {
    const root = makeTempDir('extjs-webonly-')
    fs.mkdirSync(root, {recursive: true})
    fs.writeFileSync(path.join(root, 'manifest.json'), '{}')
    const s = await getProjectStructure(root)
    expect(s.manifestPath.endsWith('manifest.json')).toBe(true)
    expect(s.packageJsonPath).toBeUndefined()
  })
})
