import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {fetchExtensionFromStore} from 'extension-from-store'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {resolveCompanionExtensionsConfig} from '../folder-extensions/resolve-config.ts'
import {resolveCompanionExtensionDirs} from '../folder-extensions/resolve-dirs.ts'

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
    } catch {
      // Ignore
    }
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

  it('scans <browser>/* subfolders for a custom extensions dir too', () => {
    const root = tmpDir('extjs-companion-custom-')
    writeManifest(path.join(root, 'companions', 'other'))
    writeManifest(path.join(root, 'companions', 'chrome', 'c1'))

    const dirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {dir: './companions'}
    })

    const normalized = dirs.map((value) => toPosix(value).toLowerCase())
    expect(normalized).toContain(
      toPosix(path.join(root, 'companions', 'other')).toLowerCase()
    )
    expect(normalized).toContain(
      toPosix(path.join(root, 'companions', 'chrome', 'c1')).toLowerCase()
    )
  })

  it('loads a browser-named subfolder only for its browser, shared and explicit entries for every browser', () => {
    const root = tmpDir('extjs-companion-scope-')
    writeManifest(path.join(root, 'extensions', 'shared'))
    writeManifest(path.join(root, 'extensions', 'chrome', 'c1'))
    writeManifest(path.join(root, 'extensions', 'firefox', 'f1'))
    writeManifest(path.join(root, 'extensions', 'edge', 'e1'))
    writeManifest(path.join(root, 'extensions', 'explicit-only'))

    const resolveFor = (browser: string) =>
      resolveCompanionExtensionDirs({
        projectRoot: root,
        config: {dir: './extensions', paths: ['./extensions/explicit-only']},
        browser
      }).map((value) => toPosix(path.relative(root, value)).toLowerCase())

    expect(resolveFor('firefox').sort()).toEqual([
      'extensions/explicit-only',
      'extensions/firefox/f1',
      'extensions/shared'
    ])
    expect(resolveFor('chrome').sort()).toEqual([
      'extensions/chrome/c1',
      'extensions/explicit-only',
      'extensions/shared'
    ])
    expect(resolveFor('edge').sort()).toEqual([
      'extensions/edge/e1',
      'extensions/explicit-only',
      'extensions/shared'
    ])
    // Gecko forks share the firefox folder; unknown chromium names the chrome one.
    expect(resolveFor('waterfox')).toContain('extensions/firefox/f1')
    expect(resolveFor('chromium-based')).toContain('extensions/chrome/c1')
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

  it('recognises legacy, scheme-less and www store links as the same chrome id', async () => {
    const id = 'fmkadmapgofadopljbjfkapdkoienihi'
    for (const link of [
      `https://chrome.google.com/webstore/detail/react-developer-tools/${id}`,
      `chromewebstore.google.com/detail/react-developer-tools/${id}`,
      `https://www.chromewebstore.google.com/detail/react-developer-tools/${id}`
    ]) {
      const root = tmpDir('extjs-companion-link-forms-')
      mockFetchSuccess((outDir) => {
        writeManifest(path.join(outDir, `${id}@7.0.1`))
      })
      const resolved = await resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: [link]
      })
      const resolvedPaths = Array.isArray(resolved) ? resolved : resolved?.paths
      expect(resolvedPaths, link).toEqual([
        path.join(root, 'extensions', 'chrome', id)
      ])
    }
  })

  it('reports a link it cannot recognise as a link, not as a folder', async () => {
    const root = tmpDir('extjs-companion-bad-link-')
    for (const link of [
      'https://chromewebstore.google.com/category/extensions',
      'https://chromewebstore.gogle.com/detail/tool/fmkadmapgofadopljbjfkapdkoienihi',
      'https://example.com/some/extension'
    ]) {
      await expect(
        resolveCompanionExtensionsConfig({
          projectRoot: root,
          browser: 'chrome',
          config: [link]
        }),
        link
      ).rejects.toThrow(/not a store link this resolver recognises/)
    }
  })

  it('reports a bare store id and an unrecognisable entry instead of dropping them', async () => {
    const root = tmpDir('extjs-companion-bare-')
    await expect(
      resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: ['fmkadmapgofadopljbjfkapdkoienihi']
      })
    ).rejects.toThrow(/looks like a store id, not a store link/)
    await expect(
      resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: ['react-devtools']
      })
    ).rejects.toThrow(/neither a store link nor a folder path/)
  })

  it('keeps skipping the other browser link quietly, in every link form', async () => {
    const root = tmpDir('extjs-companion-other-browser-')
    const resolved = await resolveCompanionExtensionsConfig({
      projectRoot: root,
      browser: 'chrome',
      config: [
        'https://addons.mozilla.org/en-US/firefox/addon/react-devtools/',
        'addons.mozilla.org/en-US/firefox/addon/react-devtools/'
      ]
    })
    const resolvedPaths = Array.isArray(resolved) ? resolved : resolved?.paths
    expect(resolvedPaths || []).toEqual([])
    expect(fetchExtensionFromStore).not.toHaveBeenCalled()
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
