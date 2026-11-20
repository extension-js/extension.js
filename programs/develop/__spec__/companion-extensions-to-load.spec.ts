import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveCompanionExtensionDirs} from '../lib/companion-extensions/resolve-dirs'
import {
  companionsDeclaredIn,
  computeExtensionsToLoad,
  isFirstCompanionWarning,
  namedCompanionFoldersInsideProject,
  unresolvedNamedCompanions
} from '../lib/extensions-to-load'

const created: string[] = []
const toPosix = (value: string) => value.replace(/\\/g, '/')

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)

  return dir
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
})

describe('companion extensions (load-only) are wired into BrowsersPlugin', () => {
  it('includes scanned extensions/<name> (manifest.json) and keeps user extension output last', async () => {
    const root = tmpDir('extjs-companion-wire-')

    const pkgPath = path.join(root, 'package.json')
    const manifestPath = path.join(root, 'manifest.json')
    fs.writeFileSync(pkgPath, JSON.stringify({name: 'x'}), 'utf-8')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, name: 'x', version: '0.0.0'}),
      'utf-8'
    )

    const companionRoot = path.join(root, 'extensions', 'other')
    fs.mkdirSync(companionRoot, {recursive: true})
    fs.writeFileSync(
      path.join(companionRoot, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'other', version: '0.0.0'}),
      'utf-8'
    )

    const companionDirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {dir: './extensions'}
    })
    const userOut = path.resolve(root, 'dist', 'chrome')
    const extList = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      companionDirs
    )

    const normalizePath = (value: string) =>
      toPosix(value).replace(/\/+$/, '').toLowerCase()
    const normalized = extList.map((value: string) => normalizePath(value))
    const userSuffix = normalizePath(path.join('dist', 'chrome'))
    const companionSuffix = normalizePath(path.join('extensions', 'other'))
    const companionIndex = normalized.findIndex((p) =>
      p.endsWith(companionSuffix)
    )
    const userIndex = normalized.findIndex((p) => p.endsWith(userSuffix))
    expect(companionIndex).toBeGreaterThanOrEqual(0)
    expect(normalized[normalized.length - 1].endsWith(userSuffix)).toBe(true)
    expect(companionIndex).toBeLessThan(userIndex)
  })

  it('does not load built-in devtools when both built-in and user define new tab override', () => {
    const root = tmpDir('extjs-devtools-ntp-guard-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'user/newtab.html'}
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'pages/newtab.html'}
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      []
    )
    expect(list).toEqual([userOut])
  })

  it('loads built-in devtools to provide blank new tab when user has no new tab override', () => {
    const root = tmpDir('extjs-devtools-ntp-default-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'pages/newtab.html'}
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      []
    )
    expect(list).toEqual([devtoolsForBrowser, userOut])
  })

  it('falls back to monorepo extensions/*/dist when programs/develop/dist is absent', () => {
    const root = tmpDir('extjs-devtools-fallback-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const fallbackDevtoolsForBrowser = path.join(
      root,
      'extensions',
      'extension-js-devtools',
      'dist',
      'chrome'
    )
    const fallbackThemeForBrowser = path.join(
      root,
      'extensions',
      'extension-js-theme',
      'dist',
      'chrome'
    )
    fs.mkdirSync(fallbackDevtoolsForBrowser, {recursive: true})
    fs.mkdirSync(fallbackThemeForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(fallbackDevtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js DevTools',
        version: '0.0.0'
      }),
      'utf-8'
    )

    fs.writeFileSync(
      path.join(fallbackThemeForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      path.join(root, 'programs', 'develop'),
      'development',
      'chrome',
      userOut,
      []
    )

    expect(list).toEqual([
      path.resolve(fallbackDevtoolsForBrowser),
      path.resolve(fallbackThemeForBrowser),
      userOut
    ])
  })

  it('loads devtools and the theme before the user extension in development, and the theme alone in production', () => {
    const root = tmpDir('extjs-builtins-always-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    const themeForBrowser = path.join(
      root,
      'dist',
      'extension-js-theme',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.mkdirSync(themeForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js DevTools',
        version: '0.0.0'
      }),
      'utf-8'
    )

    fs.writeFileSync(
      path.join(themeForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    expect(
      computeExtensionsToLoad(root, 'development', 'chrome', userOut, [])
    ).toEqual([devtoolsForBrowser, themeForBrowser, userOut])

    // A production build is loaded as it ships: no dev-only companion.
    expect(
      computeExtensionsToLoad(root, 'production', 'chrome', userOut, [])
    ).toEqual([themeForBrowser, userOut])
  })

  describe('a project that is a built-in itself', () => {
    function firefoxBuiltIns(root: string) {
      const devtools = path.join(
        root,
        'dist',
        'extension-js-devtools',
        'firefox'
      )
      const theme = path.join(root, 'dist', 'extension-js-theme', 'firefox')

      const write = (dir: string, manifest: object) => {
        fs.mkdirSync(dir, {recursive: true})
        fs.writeFileSync(
          path.join(dir, 'manifest.json'),
          JSON.stringify(manifest)
        )
      }

      write(devtools, {
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        browser_specific_settings: {gecko: {id: 'devtools@extension.js'}}
      })

      write(theme, {
        manifest_version: 2,
        name: 'Extension.js Theme',
        version: '0.0.0',
        theme: {colors: {}}
      })

      return {devtools, theme}
    }

    it('leaves the built-in devtools out when the project carries its gecko id', () => {
      const root = tmpDir('extjs-builtin-same-id-')
      const {theme} = firefoxBuiltIns(root)
      const userOut = path.join(root, 'user', 'dist', 'firefox')
      fs.mkdirSync(userOut, {recursive: true})
      fs.writeFileSync(
        path.join(userOut, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Extension.js',
          version: '0.0.0',
          browser_specific_settings: {gecko: {id: 'devtools@extension.js'}}
        })
      )

      expect(
        computeExtensionsToLoad(root, 'development', 'firefox', userOut, [])
      ).toEqual([theme, userOut])
    })

    it('leaves the built-in devtools out when the project has its package name', () => {
      const root = tmpDir('extjs-builtin-same-package-')
      const {theme} = firefoxBuiltIns(root)
      const project = path.join(root, 'user')
      const userOut = path.join(project, 'dist', 'firefox')
      fs.mkdirSync(path.join(project, 'src'), {recursive: true})
      fs.writeFileSync(
        path.join(project, 'package.json'),
        JSON.stringify({name: 'extension-js-devtools'})
      )

      fs.writeFileSync(
        path.join(project, 'src', 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Extension.js',
          version: '0.0.0',
          applications: {gecko: {id: 'another@example.com'}}
        })
      )

      expect(
        computeExtensionsToLoad(
          root,
          'development',
          'firefox',
          userOut,
          [],
          path.join(project, 'src', 'manifest.json')
        )
      ).toEqual([theme, userOut])
    })

    it('keeps the built-in devtools for a project with another id and name', () => {
      const root = tmpDir('extjs-builtin-other-')
      const {devtools, theme} = firefoxBuiltIns(root)
      const userOut = path.join(root, 'user', 'dist', 'firefox')
      fs.mkdirSync(userOut, {recursive: true})
      fs.writeFileSync(
        path.join(userOut, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Mine',
          version: '0.0.0',
          browser_specific_settings: {gecko: {id: 'mine@example.com'}}
        })
      )

      expect(
        computeExtensionsToLoad(root, 'development', 'firefox', userOut, [])
      ).toEqual([devtools, theme, userOut])
    })
  })

  it('leaves the built-in theme out for Opera and Yandex and keeps it for the other Chromium targets', () => {
    const root = tmpDir('extjs-builtins-theme-refusal-')
    const userOut = path.join(root, 'dist', 'chromium')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'User', version: '0.0.0'}),
      'utf-8'
    )

    const devtools = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chromium'
    )
    const theme = path.join(root, 'dist', 'extension-js-theme', 'chromium')
    fs.mkdirSync(devtools, {recursive: true})
    fs.mkdirSync(theme, {recursive: true})
    fs.writeFileSync(
      path.join(devtools, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'DevTools', version: '0.0.0'}),
      'utf-8'
    )

    fs.writeFileSync(
      path.join(theme, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Theme',
        version: '0.0.0',
        theme: {}
      }),
      'utf-8'
    )

    for (const browser of ['opera', 'yandex']) {
      expect(
        computeExtensionsToLoad(root, 'development', browser, userOut, [])
      ).toEqual([devtools, userOut])
    }

    for (const browser of ['chromium', 'brave', 'vivaldi']) {
      expect(
        computeExtensionsToLoad(root, 'development', browser, userOut, [])
      ).toEqual([devtools, theme, userOut])
    }
  })

  it('skips built-in devtools when user source manifest defines newtab but output manifest is not built yet', () => {
    const root = tmpDir('extjs-devtools-source-manifest-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})

    const sourceManifestPath = path.join(root, 'manifest.json')
    fs.writeFileSync(
      sourceManifestPath,
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'user/newtab.html'}
      }),
      'utf-8'
    )

    const devtoolsForBrowser = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    const themeForBrowser = path.join(
      root,
      'dist',
      'extension-js-theme',
      'chrome'
    )
    fs.mkdirSync(devtoolsForBrowser, {recursive: true})
    fs.mkdirSync(themeForBrowser, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0',
        chrome_url_overrides: {newtab: 'pages/newtab.html'}
      }),
      'utf-8'
    )

    fs.writeFileSync(
      path.join(themeForBrowser, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      [],
      sourceManifestPath
    )
    expect(list).toEqual([themeForBrowser, userOut])
  })

  it('skips companion entries whose basename matches a reserved built-in package', () => {
    const root = tmpDir('extjs-devtools-companion-shadow-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const devtoolsBuiltIn = path.join(
      root,
      'dist',
      'extension-js-devtools',
      'chrome'
    )
    const themeBuiltIn = path.join(root, 'dist', 'extension-js-theme', 'chrome')
    fs.mkdirSync(devtoolsBuiltIn, {recursive: true})
    fs.mkdirSync(themeBuiltIn, {recursive: true})
    fs.writeFileSync(
      path.join(devtoolsBuiltIn, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js',
        version: '0.0.0'
      }),
      'utf-8'
    )

    fs.writeFileSync(
      path.join(themeBuiltIn, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Extension.js Theme',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const shadowDevtools = path.join(
      root,
      'extensions',
      'extension-js-devtools'
    )
    const shadowTheme = path.join(root, 'extensions', 'extension-js-theme')
    fs.mkdirSync(shadowDevtools, {recursive: true})
    fs.mkdirSync(shadowTheme, {recursive: true})

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      [shadowDevtools, shadowTheme]
    )

    expect(list).toEqual([devtoolsBuiltIn, themeBuiltIn, userOut])
  })

  it('keeps the user extension LAST when a companion names the same path', () => {
    const root = tmpDir('extjs-user-last-precedence-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const companion = path.join(root, 'extensions', 'other')
    fs.mkdirSync(companion, {recursive: true})
    fs.writeFileSync(
      path.join(companion, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'other', version: '0.0.0'}),
      'utf-8'
    )

    // The user path appears FIRST among companions (plus an aliased spelling):
    // it must still land last, or last-loaded precedence silently flips.
    const aliasedUserOut = path.join(userOut, '.', '..', 'chrome')
    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      [userOut, aliasedUserOut, companion]
    )

    expect(
      list.filter((p) => path.resolve(p) === path.resolve(userOut))
    ).toHaveLength(1)

    expect(path.resolve(list[list.length - 1])).toBe(path.resolve(userOut))
    expect(list.indexOf(companion)).toBeLessThan(
      list.findIndex((p) => path.resolve(p) === path.resolve(userOut))
    )
  })

  it('dedupes the final load list by absolute path', () => {
    const root = tmpDir('extjs-load-dedupe-')
    const userOut = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(userOut, {recursive: true})
    fs.writeFileSync(
      path.join(userOut, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'User Extension',
        version: '0.0.0'
      }),
      'utf-8'
    )

    const aliasedUserOut = path.join(userOut, '.', '..', 'chrome')

    const list = computeExtensionsToLoad(
      root,
      'development',
      'chrome',
      userOut,
      [userOut, aliasedUserOut]
    )

    expect(
      list.filter((p) => path.resolve(p) === path.resolve(userOut))
    ).toHaveLength(1)
  })
})

describe('a companion that does not resolve', () => {
  it('is named as it was typed, with where it was declared', () => {
    const root = tmpDir('extjs-companion-named-')
    const manifestPath = path.join(root, 'extensions', 'typo', 'manifest.json')
    const [unresolved, ...rest] = unresolvedNamedCompanions({
      projectRoot: root,
      resolved: {paths: [path.join(root, 'extensions', 'typo')]},
      declared: ['./extensions/typo'],
      declaredIn: 'the --extensions flag'
    })

    expect(rest).toEqual([])
    expect(unresolved.manifestPath).toBe(manifestPath)
    expect(unresolved.coded).toBe(
      'W_COMPANION_EXTENSION_PATH: A companion extension entry is not an unpacked extension folder, so it is not loaded.\n' +
        'ENTRY ./extensions/typo\n' +
        'DECLARED IN the --extensions flag\n' +
        `NOT FOUND ${manifestPath}\n` +
        'Point the entry at a folder that holds a manifest.json, or remove it.'
    )

    expect(unresolved.frame).toContain('ENTRY')
  })

  it('names the resolved path when only that is known, and each entry once', () => {
    const root = tmpDir('extjs-companion-named-')
    const folder = path.join(root, 'extensions', 'no-manifest')

    fs.mkdirSync(folder, {recursive: true})

    const unresolved = unresolvedNamedCompanions({
      projectRoot: root,
      resolved: [folder, folder]
    })

    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].coded).toContain(`ENTRY ${folder}`)
    expect(unresolved[0].coded).toContain('DECLARED IN the extensions option')
  })

  it('passes a named companion that is an extension, and a folder scan', () => {
    const root = tmpDir('extjs-companion-named-')
    const folder = path.join(root, 'extensions', 'other')

    fs.mkdirSync(folder, {recursive: true})
    fs.writeFileSync(path.join(folder, 'manifest.json'), '{}')

    expect(
      unresolvedNamedCompanions({projectRoot: root, resolved: [folder]})
    ).toEqual([])

    expect(
      unresolvedNamedCompanions({
        projectRoot: root,
        resolved: {dir: './extensions'},
        declaredIn: 'extensions in extension.config.js'
      })
    ).toEqual([])

    expect(
      unresolvedNamedCompanions({projectRoot: root, resolved: undefined})
    ).toEqual([])
  })

  it('names a declared extensions.dir that is not on disk, once', () => {
    const root = tmpDir('extjs-companion-dir-')
    const folder = path.join(root, 'extensions', 'none')
    const unresolved = unresolvedNamedCompanions({
      projectRoot: root,
      resolved: {dir: './extensions/none'},
      declaredIn: 'extensions in extension.config.js'
    })

    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].manifestPath).toBe(folder)
    expect(unresolved[0].coded).toBe(
      'W_COMPANION_EXTENSION_PATH: The companion extensions folder does not exist, so no extension is loaded from it.\n' +
        'DIR ./extensions/none\n' +
        'DECLARED IN extensions in extension.config.js\n' +
        `NOT FOUND ${folder}\n` +
        'Create the folder, or remove extensions.dir.'
    )

    // The compiler config meets the same folder with no layer to name.
    expect(
      unresolvedNamedCompanions({
        projectRoot: root,
        resolved: {dir: './extensions/none'}
      }).map((companion) => companion.manifestPath)
    ).toEqual([folder])

    expect(isFirstCompanionWarning(folder)).toBe(true)
    expect(isFirstCompanionWarning(folder)).toBe(false)
  })

  it('stays quiet about the stock ./extensions scan when no layer declared it', () => {
    const root = tmpDir('extjs-companion-dir-')

    expect(
      unresolvedNamedCompanions({
        projectRoot: root,
        resolved: {dir: './extensions'}
      })
    ).toEqual([])

    // The same spelling, declared by a layer, is the user's and is named.
    expect(
      unresolvedNamedCompanions({
        projectRoot: root,
        resolved: {dir: './extensions'},
        declaredIn: 'the --extensions flag'
      })
    ).toHaveLength(1)
  })

  it('reads an entry that names a folder on disk as a folder, whatever it looks like', () => {
    const root = tmpDir('extjs-companion-folder-')
    const storeId = 'abcdefghijklmnopabcdefghijklmnop'
    const links = [
      'chromewebstore.google.com/detail/some-name/abcdefghijklmnopabcdefghijklmnop',
      'https://example.com/not-a-store'
    ]

    // A link is never a folder, and a path with a slash always is.
    expect(
      namedCompanionFoldersInsideProject([...links, 'my.ext/foo'], root)
    ).toEqual(['my.ext/foo'])

    for (const entry of ['my.ext/foo', storeId, 'plain']) {
      fs.mkdirSync(path.join(root, entry), {recursive: true})
    }

    expect(
      namedCompanionFoldersInsideProject(
        [...links, 'my.ext/foo', storeId, 'plain'],
        root
      )
    ).toEqual(['my.ext/foo', storeId, 'plain'])
  })

  it('counts a companion as new once in a process', () => {
    const manifestPath = path.join(tmpDir('extjs-companion-once-'), 'm.json')

    expect(isFirstCompanionWarning(manifestPath)).toBe(true)
    expect(isFirstCompanionWarning(manifestPath)).toBe(false)
  })

  it('says which layer declared the companions, first one wins', () => {
    const all = {flag: [], command: [], browser: [], project: []}

    expect(companionsDeclaredIn('preview', all)).toBe('the --extensions flag')
    expect(companionsDeclaredIn('start', {...all, flag: undefined})).toBe(
      'commands.start.extensions in extension.config.js'
    )

    expect(companionsDeclaredIn('dev', {browser: [], project: []})).toBe(
      'the browser section of extension.config.js'
    )

    expect(companionsDeclaredIn('dev', {project: []})).toBe(
      'extensions in extension.config.js'
    )

    expect(companionsDeclaredIn('dev', {})).toBeUndefined()
  })

  it('stays quiet when a built-in companion is absent', () => {
    const root = tmpDir('extjs-companion-builtin-absent-')
    const userOut = path.join(root, 'dist', 'chrome')

    expect(
      computeExtensionsToLoad(root, 'development', 'chrome', userOut, [])
    ).toEqual([userOut])
  })
})
