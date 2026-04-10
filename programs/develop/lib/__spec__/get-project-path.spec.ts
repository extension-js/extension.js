import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {getProjectPath, getProjectStructure} from '../project'

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

  it('treats GitHub .zip URLs as direct archives', async () => {
    const root = makeTempDir('extjs-github-zip-')
    const extracted = path.join(root, 'content-react.chrome')
    const url =
      'https://github.com/extension-js/examples/releases/download/nightly/content-react.chrome.zip'
    const cwd = process.cwd()
    const downloadAndExtractZip = vi.fn(async () => {
      fs.mkdirSync(extracted, {recursive: true})
      return extracted
    })

    try {
      process.chdir(root)
      vi.doMock('../zip', () => ({downloadAndExtractZip}))
      const {getProjectPath: freshGetProjectPath} = await import('../project')
      const result = await freshGetProjectPath(url)
      expect(result).toBe(extracted)
      expect(downloadAndExtractZip).toHaveBeenCalledTimes(1)
      const [, targetPath] = downloadAndExtractZip.mock.calls[0]
      expect(fs.realpathSync(targetPath)).toBe(fs.realpathSync(root))
    } finally {
      process.chdir(cwd)
      vi.doUnmock('../zip')
    }
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

  it('getProjectStructure ignores manifest.json under public/', async () => {
    const root = makeTempDir('extjs-public-skip-')
    const publicDir = path.join(root, 'public', 'sample')
    const srcDir = path.join(root, 'src')
    fs.mkdirSync(publicDir, {recursive: true})
    fs.mkdirSync(srcDir, {recursive: true})
    fs.writeFileSync(path.join(publicDir, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(srcDir, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(srcDir)
  })

  it('prefers src/manifest.json over root manifest.json', async () => {
    const root = makeTempDir('extjs-manifest-prefer-src-')
    const srcDir = path.join(root, 'src')
    fs.mkdirSync(srcDir, {recursive: true})
    fs.writeFileSync(path.join(root, 'manifest.json'), '{"name":"root"}')
    fs.writeFileSync(path.join(srcDir, 'manifest.json'), '{"name":"src"}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(srcDir)
  })

  it('rejects manifest.json resolved under <packageRoot>/public', async () => {
    const root = makeTempDir('extjs-manifest-public-guard-')
    const publicDir = path.join(root, 'public', 'sample')
    fs.mkdirSync(publicDir, {recursive: true})
    fs.writeFileSync(path.join(publicDir, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(/manifest\.json/i)
  })

  it('does not guess nested manifest when package.json exists', async () => {
    const root = makeTempDir('extjs-manifest-no-guess-')
    const nested = path.join(root, 'nested', 'ext')
    fs.mkdirSync(nested, {recursive: true})
    fs.writeFileSync(path.join(nested, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(/manifest\.json/i)
  })
})
