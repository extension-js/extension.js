import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest'
import * as path from 'path'
import os from 'os'
import {resolveCompanionExtensionsConfig} from '../folder-extensions/resolve-config.ts'
import {resolveCompanionExtensionDirs} from '../folder-extensions/resolve-dirs.ts'
import * as fs from 'fs'
import {fetchExtensionFromStore} from 'extension-from-store'

vi.mock('extension-from-store', () => ({
  fetchExtensionFromStore: vi.fn()
}))

const created: string[] = []
const toPosix = (value: string) => value.replace(/\\/g, '/')

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

function writeManifest(dir: string) {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'x', version: '0.0.0'}),
    'utf-8'
  )
}

function mockFetchSuccess(onFetch?: (outDir: string) => void) {
  const fetchMock = vi.mocked(fetchExtensionFromStore)
  fetchMock.mockImplementation(async (_url: string, options: any) => {
    if (onFetch && options?.outDir) {
      onFetch(String(options.outDir))
    }
  })
  return fetchMock
}

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {}
  }
  created.length = 0
  vi.restoreAllMocks()
})

describe('companion extensions resolver', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.mocked(fetchExtensionFromStore).mockReset()
  })

  it('scans extensions/* and extensions/<browser>/* when dir is ./extensions', () => {
    const root = tmpDir('extjs-companion-scan-')
    writeManifest(path.join(root, 'extensions', 'other'))
    writeManifest(path.join(root, 'extensions', 'chrome', 'c1'))

    const dirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {dir: './extensions'}
    })

    const normalized = dirs.map((value) => toPosix(value).toLowerCase())
    expect(normalized).toContain(
      toPosix(path.join(root, 'extensions', 'other')).toLowerCase()
    )
    expect(normalized).toContain(
      toPosix(path.join(root, 'extensions', 'chrome', 'c1')).toLowerCase()
    )
  })

  it('rejects local paths outside ./extensions', async () => {
    const root = tmpDir('extjs-companion-outside-')

    await expect(
      resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: {paths: ['../outside']}
      })
    ).rejects.toThrow(/Companion extensions must be inside/)
  })

  it('resolves store URLs into extensions/<browser>/<id> and skips other browsers', async () => {
    const root = tmpDir('extjs-companion-store-')
    const id = 'fmkadmapgofadopljbjfkapdkoienihi'

    mockFetchSuccess((outDir) => {
      writeManifest(path.join(outDir, `${id}@7.0.1`))
    })

    const resolved = await resolveCompanionExtensionsConfig({
      projectRoot: root,
      browser: 'chrome',
      config: [
        `https://chromewebstore.google.com/detail/react-developer-tools/${id}?hl=en`,
        'https://microsoftedge.microsoft.com/addons/detail/react-developer-tools/gpphkfbcpidddadnkolkpfckpihlkkil'
      ]
    })

    const target = path.join(root, 'extensions', 'chrome', id)
    const resolvedPaths = Array.isArray(resolved) ? resolved : resolved?.paths
    expect(resolvedPaths).toEqual([target])
    expect(fs.existsSync(path.join(target, 'manifest.json'))).toBe(true)
  })

  it('skips store download when manifest already exists', async () => {
    const root = tmpDir('extjs-companion-skip-')
    const id = 'fmkadmapgofadopljbjfkapdkoienihi'
    const target = path.join(root, 'extensions', 'chrome', id)
    writeManifest(target)

    const fetchMock = mockFetchSuccess()

    const resolved = await resolveCompanionExtensionsConfig({
      projectRoot: root,
      browser: 'chrome',
      config: [
        `https://chromewebstore.google.com/detail/react-developer-tools/${id}?hl=en`
      ]
    })

    const resolvedPaths = Array.isArray(resolved) ? resolved : resolved?.paths
    expect(resolvedPaths).toEqual([target])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
