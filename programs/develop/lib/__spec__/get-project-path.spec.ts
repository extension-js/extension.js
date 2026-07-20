import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
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

  it('auto-extracts a local .zip and resolves its manifest', async () => {
    const root = makeTempDir('extjs-local-zip-')
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from('{"name":"local-zip"}'))
    const zipPath = path.join(root, 'packed-extension.zip')
    zip.writeZip(zipPath)

    const cwd = process.cwd()
    try {
      process.chdir(root)
      const extracted = await getProjectPath(zipPath)
      expect(fs.realpathSync(extracted)).toBe(
        fs.realpathSync(path.join(root, 'packed-extension'))
      )

      const structure = await getProjectStructure(zipPath)
      expect(path.basename(structure.manifestPath)).toBe('manifest.json')
    } finally {
      process.chdir(cwd)
    }
  })

  it('leaves a local folder path untouched (no .zip handling)', async () => {
    const tmp = makeTempDir('extjs-folder-passthrough-')
    expect(await getProjectPath(tmp)).toBe(path.resolve(tmp))
  })

  it('getProjectStructure finds manifest recursively and optional package.json', async () => {
    const root = makeTempDir('extjs-gps-')
    const nested = path.join(root, 'nested', 'deeper')
    fs.mkdirSync(nested, {recursive: true})
    const manifestDir = path.join(nested, 'ext')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), '{}')
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

  it('auto-resolves a single nested manifest when package.json exists (workspace root)', async () => {
    const root = makeTempDir('extjs-manifest-single-candidate-')
    const nested = path.join(root, 'packages', 'ext')
    fs.mkdirSync(nested, {recursive: true})
    fs.writeFileSync(path.join(nested, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'workspace-root', workspaces: ['packages/*']})
    )
    fs.writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({name: 'ext'})
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(nested)
    const printed = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(printed).toMatch(/Workspace root detected/i)
    logSpy.mockRestore()
  })

  it('rejects when multiple nested manifests exist (ambiguous workspace)', async () => {
    const root = makeTempDir('extjs-manifest-multi-candidate-')
    const first = path.join(root, 'packages', 'ext-a')
    const second = path.join(root, 'packages', 'ext-b')
    fs.mkdirSync(first, {recursive: true})
    fs.mkdirSync(second, {recursive: true})
    fs.writeFileSync(path.join(first, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(second, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'workspace-root', workspaces: ['packages/*']})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(/manifest\.json/i)
  })

  const PWA_MANIFEST = JSON.stringify({
    name: 'My PWA',
    start_url: '/',
    display: 'standalone',
    icons: [{src: '/icon-192.png', sizes: '192x192', type: 'image/png'}]
  })

  it('skips a root PWA web-app manifest and resolves a nested extension manifest', async () => {
    const root = makeTempDir('extjs-pwa-nested-ext-')
    const extDir = path.join(root, 'extension')
    fs.mkdirSync(extDir, {recursive: true})
    fs.writeFileSync(path.join(root, 'manifest.json'), PWA_MANIFEST)
    fs.writeFileSync(
      path.join(extDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'ext', version: '1.0.0'})
    )
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = await getProjectStructure(root)
    expect(path.dirname(s.manifestPath)).toBe(extDir)
    logSpy.mockRestore()
  })

  it('rejects a lone PWA web-app manifest with a clear message', async () => {
    const root = makeTempDir('extjs-pwa-only-')
    fs.writeFileSync(path.join(root, 'manifest.json'), PWA_MANIFEST)
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pkg'})
    )

    await expect(getProjectStructure(root)).rejects.toThrow(
      /not a browser extension manifest/i
    )
  })

  it('keeps accepting minimal manifests without PWA fields', async () => {
    const root = makeTempDir('extjs-minimal-manifest-')
    fs.writeFileSync(path.join(root, 'manifest.json'), '{"name":"minimal"}')

    const s = await getProjectStructure(root)
    expect(s.manifestPath.endsWith('manifest.json')).toBe(true)
  })
})
