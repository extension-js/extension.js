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

  it('resolves a companion holding a source and a built manifest once, to the source dir', () => {
    const root = tmpDir('extjs-companion-built-copy-')
    writeManifest(path.join(root, 'extensions', 'my-helper'))
    writeManifest(path.join(root, 'extensions', 'my-helper', 'dist'))

    const dirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {dir: './extensions'},
      browser: 'chrome'
    }).map((value) => toPosix(path.relative(root, value)))

    expect(dirs).toEqual(['extensions/my-helper'])
  })

  it('still resolves a companion that lives only under dist/', () => {
    const root = tmpDir('extjs-companion-dist-only-')
    writeManifest(path.join(root, 'extensions', 'my-helper', 'dist'))

    const dirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {dir: './extensions'},
      browser: 'chrome'
    }).map((value) => toPosix(path.relative(root, value)))

    expect(dirs).toEqual(['extensions/my-helper/dist'])
  })

  it('rejects local paths outside the project', async () => {
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

  it('recognizes legacy, scheme-less and www store links as the same chrome id', async () => {
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

  it('reports a link it cannot recognize as a link, not as a folder', async () => {
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
      ).rejects.toThrow(/not a store link this resolver recognizes/)
    }
  })

  it('reports a bare store id and an unrecognizable entry instead of dropping them', async () => {
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

  describe('a bare entry with no slash and no dot', () => {
    const id = 'fmkadmapgofadopljbjfkapdkoienihi'
    const resolve = (root: string, entry: string) =>
      resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: [entry]
      })

    it('is a folder when a folder of that name is in the project', async () => {
      const root = tmpDir('extjs-companion-bare-folder-')
      writeManifest(path.join(root, 'extensions', 'inner'))

      await expect(resolve(root, 'extensions')).resolves.toEqual({
        paths: [path.join(root, 'extensions')]
      })
    })

    it('may sit at the project root like any other folder', async () => {
      const root = tmpDir('extjs-companion-bare-outside-')
      writeManifest(path.join(root, 'my-ext'))

      await expect(resolve(root, 'my-ext')).resolves.toEqual({
        paths: [path.join(root, 'my-ext')]
      })
    })

    it('is a folder even when it reads like a store ID', async () => {
      const root = tmpDir('extjs-companion-bare-id-folder-')
      writeManifest(path.join(root, id))

      // The folder answers, so nothing is fetched and no store hint is said.
      await expect(resolve(root, id)).resolves.toEqual({
        paths: [path.join(root, id)]
      })

      expect(fetchExtensionFromStore).not.toHaveBeenCalled()
    })

    it('stays an unknown entry when no folder has that name', async () => {
      const root = tmpDir('extjs-companion-bare-missing-')
      fs.mkdirSync(path.join(root, 'extensions'))

      await expect(resolve(root, 'my-ext')).rejects.toThrow(
        /neither a store link nor a folder path: my-ext/
      )

      await expect(resolve(root, id)).rejects.toThrow(
        /looks like a store id, not a store link/
      )

      // An empty entry resolves to the project itself, which names nothing.
      await expect(resolve(root, '')).rejects.toThrow(
        /neither a store link nor a folder path/
      )
    })

    it('stays an unknown entry when the name belongs to a file', async () => {
      const root = tmpDir('extjs-companion-bare-file-')
      fs.writeFileSync(path.join(root, 'my-ext'), 'a file, not a folder')
      fs.writeFileSync(path.join(root, id), 'a file, not a folder')

      await expect(resolve(root, 'my-ext')).rejects.toThrow(
        /neither a store link nor a folder path: my-ext/
      )

      await expect(resolve(root, id)).rejects.toThrow(
        /looks like a store id, not a store link/
      )
    })

    it('leaves an absolute path as it was, inside the project or not', async () => {
      const holder = tmpDir('extjs-companion-absolute-')
      const root = path.join(holder, 'project')
      const inside = path.join(root, 'extensions', 'inner')
      const atRoot = path.join(root, 'my-ext')
      const outside = path.join(holder, 'elsewhere')
      writeManifest(inside)
      writeManifest(atRoot)
      writeManifest(outside)

      await expect(resolve(root, inside)).resolves.toEqual({paths: [inside]})
      await expect(resolve(root, atRoot)).resolves.toEqual({paths: [atRoot]})
      await expect(resolve(root, outside)).rejects.toThrow(
        `Companion extensions must be inside the project.\nInvalid path: ${outside}`
      )

      // A path is a path whether or not anything is there.
      await expect(
        resolve(root, path.join(root, 'extensions', 'missing'))
      ).resolves.toEqual({paths: [path.join(root, 'extensions', 'missing')]})
    })

    it('reads a backslash as a separator only where the platform does', async () => {
      const root = tmpDir('extjs-companion-backslash-')
      writeManifest(path.join(root, 'extensions', 'inner'))
      const attempt = resolve(root, 'extensions\\inner')

      if (process.platform === 'win32') {
        await expect(attempt).resolves.toEqual({
          paths: [path.join(root, 'extensions', 'inner')]
        })
      } else {
        // One file name with a backslash in it, at the project root.
        await expect(attempt).resolves.toEqual({
          paths: [path.join(root, 'extensions\\inner')]
        })
      }
    })
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

describe('a companion folder named in the config, by where it sits', () => {
  const REFUSED = 'refused'
  const canLink = process.platform !== 'win32'

  // A project one folder down, so `..` has somewhere real to land.
  function layout() {
    const holder = fs.realpathSync(tmpDir('extjs-companion-places-'))
    const root = path.join(holder, 'project')

    for (const dir of [
      'my-ext',
      'tools/my-ext',
      'extensions/my-ext',
      'node_modules/some-ext'
    ]) {
      writeManifest(path.join(root, dir))
    }

    writeManifest(path.join(holder, 'outside'))
    fs.mkdirSync(path.join(root, 'extensions', 'no-manifest'))
    fs.mkdirSync(path.join(root, 'tools', 'no-manifest'))
    fs.writeFileSync(path.join(root, 'extensions', 'a-file.txt'), 'a file')
    fs.writeFileSync(path.join(root, 'tools', 'a-file.txt'), 'a file')

    if (canLink) {
      for (const dir of ['extensions', 'tools']) {
        fs.symlinkSync(
          path.join(holder, 'outside'),
          path.join(root, dir, 'linked-out')
        )

        fs.symlinkSync(
          path.join(root, 'my-ext'),
          path.join(root, dir, 'linked-in')
        )
      }
    }

    return {holder, root}
  }

  // What a session loads for one entry, or the refusal it gets.
  async function outcome(root: string, entry: string) {
    try {
      const config = await resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: [entry]
      })

      return resolveCompanionExtensionDirs({
        projectRoot: root,
        config,
        browser: 'chrome'
      }).map((dir) => toPosix(path.relative(root, dir)))
    } catch (error) {
      return String((error as Error).message)
    }
  }

  const refusal = (root: string, entry: string) =>
    'Companion extensions must be inside the project.\n' +
    `Invalid path: ${path.isAbsolute(entry) ? entry : path.resolve(root, entry)}`

  it.each([
    ['my-ext', ['my-ext']],
    ['tools/my-ext', ['tools/my-ext']],
    ['./tools/my-ext', ['tools/my-ext']],
    ['extensions/my-ext', ['extensions/my-ext']],
    // The user named it, so it loads from there like from anywhere else.
    ['node_modules/some-ext', ['node_modules/some-ext']],
    ['../outside', REFUSED],
    ['tools/../../outside', REFUSED],
    ['..', REFUSED],
    // The project itself is not a folder inside the project.
    ['./', REFUSED],
    // A folder with no manifest, a file and a missing folder pass the place
    // check, and the session then loads nothing for them, without a word.
    ['extensions/no-manifest', []],
    ['tools/no-manifest', []],
    ['extensions/a-file.txt', []],
    ['tools/a-file.txt', []],
    ['tools/missing', []]
  ])('%s', async (entry, expected) => {
    const {root} = layout()

    expect(await outcome(root, entry)).toEqual(
      expected === REFUSED ? refusal(root, entry) : expected
    )
  })

  it('an absolute path, inside the project or not', async () => {
    const {holder, root} = layout()
    const outside = path.join(holder, 'outside')

    expect(await outcome(root, outside)).toBe(refusal(root, outside))
    expect(await outcome(root, path.join(root, 'tools', 'my-ext'))).toEqual([
      'tools/my-ext'
    ])

    expect(
      await outcome(root, path.join(root, 'extensions', 'my-ext'))
    ).toEqual(['extensions/my-ext'])
  })

  it.skipIf(!canLink)('a link, by where it leads', async () => {
    const {root} = layout()

    // Real paths are compared, so a link out of the project is refused
    // wherever it sits, extensions/ included.
    for (const entry of ['extensions/linked-out', 'tools/linked-out']) {
      expect(await outcome(root, entry), entry).toBe(refusal(root, entry))
    }

    for (const entry of ['extensions/linked-in', 'tools/linked-in']) {
      expect(await outcome(root, entry), entry).toEqual([entry])
    }
  })

  it.skipIf(!canLink)('a project reached through a link', async () => {
    const {holder, root} = layout()
    const linkedRoot = path.join(holder, 'linked-project')
    fs.symlinkSync(root, linkedRoot)

    expect(await outcome(linkedRoot, 'tools/my-ext')).toEqual(['tools/my-ext'])
    expect(await outcome(linkedRoot, path.join(root, 'my-ext'))).toEqual([
      '../project/my-ext'
    ])

    expect(await outcome(linkedRoot, '../outside')).toBe(
      refusal(linkedRoot, '../outside')
    )
  })

  it('names a folder inside the project when an entry is no path and no link', async () => {
    const {root} = layout()

    expect(await outcome(root, 'not-there')).toBe(
      'Companion extension entry is neither a store link nor a folder path: not-there\n' +
        'Give a store link or the path of a folder inside the project'
    )
  })
})

describe('the folder scanned for companion extensions, by where it sits', () => {
  const canLink = process.platform !== 'win32'

  // A project one folder down, so `..` has somewhere real to land.
  function layout() {
    const holder = fs.realpathSync(tmpDir('extjs-companion-dir-'))
    const root = path.join(holder, 'project')

    for (const dir of [
      'extensions/one',
      'extensions/set/inner',
      'vendor/two',
      'node_modules/kept/three'
    ]) {
      writeManifest(path.join(root, dir))
    }

    writeManifest(path.join(holder, 'outside', 'four'))

    if (canLink) {
      fs.symlinkSync(
        path.join(holder, 'outside'),
        path.join(root, 'linked-dir')
      )

      fs.symlinkSync(
        path.join(holder, 'outside'),
        path.join(root, 'extensions', 'linked-set')
      )

      fs.symlinkSync(path.join(root, 'vendor'), path.join(root, 'linked-in'))
    }

    return {holder, root}
  }

  // What a session loads for one `dir`, or the refusal it gets.
  async function outcome(root: string, dir: string) {
    try {
      const config = await resolveCompanionExtensionsConfig({
        projectRoot: root,
        browser: 'chrome',
        config: {dir}
      })

      return resolveCompanionExtensionDirs({
        projectRoot: root,
        config,
        browser: 'chrome'
      }).map((found) => toPosix(path.relative(root, found)))
    } catch (error) {
      return String((error as Error).message)
    }
  }

  const refusal = (root: string, dir: string) =>
    'extensions.dir must be inside the project.\n' +
    `Invalid dir: ${path.isAbsolute(dir) ? dir : path.resolve(root, dir)}`

  const REFUSED = 'refused'
  // A subfolder that is no extension is read one level down.
  const DEFAULT_SET = ['extensions/one', 'extensions/set/inner']

  it.each([
    ['extensions', DEFAULT_SET],
    ['./extensions', DEFAULT_SET],
    ['extensions/set', ['extensions/set/inner']],
    ['./vendor', ['vendor/two']],
    // The user named it, so it is scanned like any other folder.
    ['node_modules/kept', ['node_modules/kept/three']],
    // The project itself is not a folder inside the project.
    ['.', REFUSED],
    ['./', REFUSED],
    ['..', REFUSED],
    ['../outside', REFUSED],
    ['vendor/../../outside', REFUSED],
    // A folder that is not there scans nothing, without a word, when the
    // place it would sit at is inside the project.
    ['extensions/missing', []],
    ['missing', []],
    ['../missing', REFUSED]
  ])('%s', async (dir, expected) => {
    const {root} = layout()

    expect(await outcome(root, dir)).toEqual(
      expected === REFUSED ? refusal(root, dir) : expected
    )
  })

  it('an absolute path, inside the project or not', async () => {
    const {holder, root} = layout()
    const outside = path.join(holder, 'outside')
    const vendor = path.join(root, 'vendor')

    expect(await outcome(root, outside)).toBe(refusal(root, outside))
    expect(await outcome(root, root)).toBe(refusal(root, root))
    expect(await outcome(root, vendor)).toEqual(['vendor/two'])
    expect(await outcome(root, path.join(root, 'extensions'))).toEqual(
      DEFAULT_SET
    )
  })

  it.skipIf(!canLink)('a link, by where it leads', async () => {
    const {root} = layout()

    // Real paths are compared, so a link out of the project is refused
    // wherever it sits, extensions/ included.
    for (const dir of ['linked-dir', 'extensions/linked-set']) {
      expect(await outcome(root, dir), dir).toBe(refusal(root, dir))
    }

    expect(await outcome(root, 'linked-in')).toEqual(['linked-in/two'])
  })

  it.skipIf(!canLink)('a project reached through a link', async () => {
    const {holder, root} = layout()
    const linkedRoot = path.join(holder, 'linked-project')
    fs.symlinkSync(root, linkedRoot)

    expect(await outcome(linkedRoot, 'vendor')).toEqual(['vendor/two'])
    expect(await outcome(linkedRoot, path.join(root, 'vendor'))).toEqual([
      '../project/vendor/two'
    ])

    expect(await outcome(linkedRoot, '../outside')).toBe(
      refusal(linkedRoot, '../outside')
    )
  })

  it('refuses with a code a machine reader can match on', async () => {
    const {root} = layout()

    const refused = async (config: {dir: string} | string[]) => {
      try {
        await resolveCompanionExtensionsConfig({
          projectRoot: root,
          browser: 'chrome',
          config
        })
      } catch (error) {
        return (error as {code?: string}).code
      }

      return 'accepted'
    }

    expect(await refused({dir: '../outside'})).toBe(
      'E_COMPANION_EXTENSION_PATH'
    )

    expect(await refused({dir: '.'})).toBe('E_COMPANION_EXTENSION_PATH')
    expect(await refused(['../outside'])).toBe('E_COMPANION_EXTENSION_PATH')
    expect(await refused({dir: './vendor'})).toBe('accepted')
  })

  it.skipIf(!canLink)(
    'never follows a link that is one entry of the scanned folder',
    async () => {
      const {holder, root} = layout()

      fs.symlinkSync(
        path.join(holder, 'outside', 'four'),
        path.join(root, 'extensions', 'linked-out')
      )

      fs.symlinkSync(
        path.join(root, 'vendor', 'two'),
        path.join(root, 'extensions', 'linked-two')
      )

      // The scan reads folders only, and a link is not one, so neither the
      // link that leads out nor the one that stays in loads anything.
      expect(await outcome(root, 'extensions')).toEqual(DEFAULT_SET)
    }
  )
})
