import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  findNestedBuildFolders,
  holdsRegistrySecret,
  isDeniedFromSourceZip,
  isOwnArchiveName,
  leftOutOfExtensionZip,
  leftOutOfSourceByName
} from '../zip'
import {
  BUILT_MANIFEST,
  readZip,
  write,
  writeProject,
  zipProject
} from './helpers/zip-archive'

// Every value below is a plain text marker, never a real key or token.
const KEY = 'FAKE-KEY-MARKER'
const TOKEN = 'FAKE-TOKEN-MARKER'

const SOURCE = ['manifest.json', 'src/background.ts']

const toWindows = (file: string) => file.replace(/\//g, '\\')

// The stored bytes and the unpacked text, so a marker cannot hide in either.
function everyByteOf(zipPath: string, packed: Record<string, string>) {
  return [
    fs.readFileSync(zipPath).toString('latin1'),
    ...Object.keys(packed),
    ...Object.values(packed)
  ].join('\n')
}

describe('what the source zip leaves out beside the build output', () => {
  let root: string
  let outPath: string
  let zipPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-left-out-'))
    outPath = path.join(root, 'dist', 'chrome')
    zipPath = path.join(root, 'dist', 'packed-1.0.0-source.zip')
    writeProject(root)
    fs.mkdirSync(outPath, {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  async function sourceZip() {
    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(zipPath)

    return {warnings, packed, names: Object.keys(packed).sort()}
  }

  it('leaves out private key containers and packed extensions, and lists them', async () => {
    const keys = [
      'key.pem',
      'certs/KEY.PEM',
      'release/packed.crx',
      'certs/store.p12',
      'certs/store.pfx',
      'android/release.jks',
      'android/debug.keystore',
      'deploy/putty.ppk',
      'deploy/id_rsa',
      'deploy/id_ed25519'
    ]

    for (const file of keys) write(path.join(root, file), KEY)

    write(
      path.join(root, 'tls', 'server.key'),
      `-----BEGIN PRIVATE KEY-----\n${KEY}\n-----END PRIVATE KEY-----\n`
    )

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual(SOURCE)
    expect(everyByteOf(zipPath, packed)).not.toContain(KEY)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/The source zip left out what is not source/)
    expect(warnings[0]).not.toContain(KEY)

    const listed = warnings[0].split('\n')[1]

    expect(listed).toMatch(/^\S*KEY FILE\S* /)
    expect(
      listed
        .replace(/^\S*KEY FILE\S* /, '')
        .split(', ')
        .sort()
    ).toEqual([...keys, 'tls/server.key'].sort())
  })

  it('packs public key material and source that only looks like a key', async () => {
    const shipped = [
      'deploy/id_rsa.pub',
      'certs/ca.crt',
      'certs/ca.cer',
      'docs/pem-format.md',
      'docs/slides.key',
      'src/crx-loader.ts',
      'src/keystore.ts',
      'src/id_rsa.ts',
      'assets/sample.zip'
    ]

    for (const file of shipped) write(path.join(root, file), 'SHIPPED')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual([...SOURCE, ...shipped].sort())
    expect(warnings).toEqual([])
  })

  it('says nothing about a key the project .gitignore already covers', async () => {
    write(path.join(root, '.gitignore'), '*.pem\n')
    write(path.join(root, 'key.pem'), KEY)

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(['.gitignore', ...SOURCE])
    expect(warnings).toEqual([])
  })

  it('leaves out a registry file that holds an auth value, and names only the file', async () => {
    write(
      path.join(root, '.npmrc'),
      `registry=https://registry.example.test/\n//registry.example.test/:_authToken=${TOKEN}\n`
    )

    write(
      path.join(root, 'packages', 'a', '.yarnrc.yml'),
      `npmRegistries:\n  "//registry.example.test":\n    npmAuthToken: "${TOKEN}"\n`
    )

    write(
      path.join(root, 'packages', 'b', '.yarnrc'),
      `"//registry.example.test/:_authToken" "${TOKEN}"\n`
    )

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual(SOURCE)
    expect(everyByteOf(zipPath, packed)).not.toContain(TOKEN)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain(TOKEN)
    expect(warnings[0]).toMatch(
      /REGISTRY AUTH\S* \.npmrc, packages\/a\/\.yarnrc\.yml, packages\/b\/\.yarnrc\n/
    )

    expect(warnings[0]).toMatch(/reads the environment/)
  })

  it('packs a registry file whose auth value reads the environment', async () => {
    write(
      path.join(root, '.npmrc'),
      `registry=https://registry.example.test/\n//registry.example.test/:_authToken=\${NPM_TOKEN}\nalways-auth=true\n`
    )

    write(
      path.join(root, '.yarnrc.yml'),
      `npmRegistryServer: "https://registry.example.test"\nnpmAuthToken: "\${NPM_TOKEN}"\n`
    )

    write(path.join(root, 'packages', 'a', '.npmrc'), 'save-exact=true\n')

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual(
      ['.npmrc', '.yarnrc.yml', ...SOURCE, 'packages/a/.npmrc'].sort()
    )

    expect(packed['.npmrc']).toContain('registry.example.test')
    expect(warnings).toEqual([])
  })

  it('leaves out the files an operating system writes, and says nothing', async () => {
    write(path.join(root, '.DS_Store'), 'FINDER')
    write(path.join(root, 'src', '.ds_store'), 'FINDER')
    write(path.join(root, 'src', 'Thumbs.db'), 'THUMBS')
    write(path.join(root, 'src', 'icons', 'THUMBS.DB'), 'THUMBS')
    write(path.join(root, 'src', 'icons', 'desktop.ini'), 'INI')
    write(path.join(root, 'src', 'desktop.init.ts'), 'SHIPPED')
    write(path.join(root, 'docs', 'DS_Store.md'), 'SHIPPED')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(
      [...SOURCE, 'docs/DS_Store.md', 'src/desktop.init.ts'].sort()
    )

    expect(warnings).toEqual([])
  })

  it('leaves out the folders a tool keeps for one machine, and says nothing', async () => {
    write(path.join(root, '.claude', 'settings.local.json'), '{}')
    write(path.join(root, 'packages', 'site', '.vercel', 'project.json'), '{}')
    write(path.join(root, '.vscode', 'settings.json'), '{}')
    write(path.join(root, '.idea', 'workspace.xml'), '<x/>')
    write(path.join(root, 'src', 'claude', 'client.ts'), 'SHIPPED')
    write(path.join(root, 'src', 'vercel.ts'), 'SHIPPED')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(
      [
        ...SOURCE,
        '.idea/workspace.xml',
        '.vscode/settings.json',
        'src/claude/client.ts',
        'src/vercel.ts'
      ].sort()
    )

    expect(warnings).toEqual([])
  })

  it('leaves out the archives of earlier runs, and lists them', async () => {
    write(path.join(root, 'web-ext-artifacts', 'packed-0.9.0.zip'), 'OLD')
    write(path.join(root, 'web-ext-artifacts', 'packed-0.8.0.zip'), 'OLD')
    write(path.join(root, 'releases', 'packed-0.9.0-chrome.zip'), 'OLD')
    write(path.join(root, 'releases', 'Packed-0.9.0-Chromium-Based.ZIP'), 'OLD')
    write(path.join(root, 'releases', 'packed-0.9.0-source.zip'), 'OLD')
    write(path.join(root, 'assets', 'sample.zip'), 'SHIPPED')
    write(path.join(root, 'assets', 'theme-chrome.zip'), 'SHIPPED')
    write(path.join(root, 'assets', 'fonts-2.1.0.zip'), 'SHIPPED')
    write(path.join(root, 'src', 'source.zip.ts'), 'SHIPPED')

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual(
      [
        ...SOURCE,
        'assets/fonts-2.1.0.zip',
        'assets/sample.zip',
        'assets/theme-chrome.zip',
        'src/source.zip.ts'
      ].sort()
    )

    expect(Object.values(packed)).not.toContain('OLD')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(
      /OLD ARCHIVE\S* releases\/Packed-0\.9\.0-Chromium-Based\.ZIP, releases\/packed-0\.9\.0-chrome\.zip, releases\/packed-0\.9\.0-source\.zip, web-ext-artifacts\n/
    )
  })

  it('leaves out a nested browser folder a build wrote, and lists it', async () => {
    write(path.join(root, 'lib', 'dist', 'chrome', 'manifest.json'), 'OLD')
    write(path.join(root, 'lib', 'dist', 'chrome', 'background.js'), 'OLD')
    write(path.join(root, 'lib', 'dist', 'chrome', 'icons', 'a.png'), 'OLD')
    write(path.join(root, 'tools', 'build', 'firefox', 'manifest.json'), 'OLD')
    write(path.join(root, 'lib', 'dist', 'index.js'), 'SHIPPED')
    write(path.join(root, 'lib', 'dist', 'chrome', '.DS_Store'), 'FINDER')

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual([...SOURCE, 'lib/dist/index.js'].sort())
    expect(Object.values(packed)).not.toContain('OLD')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(
      /BUILD OUTPUT\S* lib\/dist\/chrome, tools\/build\/firefox\n/
    )
  })

  it('packs source that only looks like a build folder', async () => {
    const shipped = [
      'src/chrome/manifest.json',
      'platform/firefox/manifest.json',
      'vendor/lib/dist/lib.min.js',
      'vendor/lib/dist/manifest.json',
      'scripts/build/release.mjs',
      'scripts/build/chrome/notes.md',
      'scripts/build/chrome/nested/manifest.json',
      'scripts/build/targets/manifest.json'
    ]

    for (const file of shipped) write(path.join(root, file), 'SHIPPED')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual([...SOURCE, ...shipped].sort())
    expect(warnings).toEqual([])
  })

  it('says nothing about a nested build folder an ignore file covers', async () => {
    write(path.join(root, '.gitignore'), 'dist\n')
    write(path.join(root, 'lib', 'dist', 'chrome', 'manifest.json'), 'OLD')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(['.gitignore', ...SOURCE])
    expect(warnings).toEqual([])
  })

  it('lists each kind once when one project holds them all', async () => {
    write(path.join(root, 'key.pem'), KEY)
    write(path.join(root, '.npmrc'), `_auth=${TOKEN}\n`)
    write(path.join(root, 'releases', 'packed-0.9.0-source.zip'), 'OLD')
    write(path.join(root, 'lib', 'build', 'edge', 'manifest.json'), 'OLD')
    write(path.join(root, '.DS_Store'), 'FINDER')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(SOURCE)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain(KEY)
    expect(warnings[0]).not.toContain(TOKEN)
    expect(warnings[0]).not.toMatch(/DS_Store|ENV FILE/)
    expect(warnings[0].split('\n').slice(1, 5)).toEqual([
      expect.stringMatching(/KEY FILE\S* key\.pem$/),
      expect.stringMatching(/REGISTRY AUTH\S* \.npmrc$/),
      expect.stringMatching(
        /OLD ARCHIVE\S* releases\/packed-0\.9\.0-source\.zip$/
      ),
      expect.stringMatching(/BUILD OUTPUT\S* lib\/build\/edge$/)
    ])
  })
})

describe('the source zip rules, read as paths', () => {
  it('reads an operating system file and a tool folder in either separator style', () => {
    const denied = [
      'src/.DS_Store',
      'src/icons/THUMBS.DB',
      'Desktop.ini',
      '.claude/settings.local.json',
      'packages/site/.Vercel/project.json',
      'config/.ENV'
    ]
    const packed = [
      '.vscode/settings.json',
      '.idea/workspace.xml',
      'src/claude/client.ts',
      'docs/DS_Store.md'
    ]

    for (const file of denied) {
      expect(isDeniedFromSourceZip(file)).toBe(true)
      expect(isDeniedFromSourceZip(toWindows(file))).toBe(true)
    }

    for (const file of packed) {
      expect(isDeniedFromSourceZip(file)).toBe(false)
      expect(isDeniedFromSourceZip(toWindows(file))).toBe(false)
    }
  })

  it('reads a key, an archive and a build folder in either separator style', () => {
    const folders = findNestedBuildFolders(
      ['lib/dist/chrome/manifest.json'].map(toWindows)
    )
    const leftOut: Array<[string, string, string]> = [
      ['certs/KEY.PEM', 'key', 'certs/KEY.PEM'],
      ['deploy/ID_RSA', 'key', 'deploy/ID_RSA'],
      ['a/Web-Ext-Artifacts/x.zip', 'archive', 'a/Web-Ext-Artifacts'],
      ['old/app-1.0.0-firefox.zip', 'archive', 'old/app-1.0.0-firefox.zip'],
      ['lib/dist/chrome/icons/a.png', 'build', 'lib/dist/chrome']
    ]

    expect(folders).toEqual(['lib/dist/chrome'])

    for (const [file, reason, named] of leftOut) {
      expect(leftOutOfSourceByName(file, folders)).toEqual({
        reason,
        path: named
      })

      expect(leftOutOfSourceByName(toWindows(file), folders)).toEqual({
        reason,
        path: named
      })
    }

    for (const file of ['docs/pem-format.md', 'src/keystore.ts', 'a/b.zip']) {
      expect(leftOutOfSourceByName(file, folders)).toBeUndefined()
      expect(leftOutOfSourceByName(toWindows(file), folders)).toBeUndefined()
    }
  })

  it('matches the two archive names this plugin writes and no other zip', () => {
    const own = [
      'my-app-1.0.0-chrome.zip',
      'my-app-0.0.0-firefox.zip',
      'app-2.1-chromium-based.zip',
      'APP-1.0.0-EDGE.ZIP',
      'my-app-1.0.0-source.zip',
      'custom-source.zip'
    ]
    const other = [
      'sample.zip',
      'theme-chrome.zip',
      'fonts-2.1.0.zip',
      'app-1.0.0-netscape.zip',
      '1.0.0-chrome.zip',
      'source.zip',
      'app-1.0.0-chrome.zip.txt'
    ]

    expect(own.filter((name) => !isOwnArchiveName(name))).toEqual([])
    expect(other.filter((name) => isOwnArchiveName(name))).toEqual([])
    expect(isOwnArchiveName('old\\my-app-1.0.0-chrome.zip')).toBe(true)
  })

  it('names a browser folder only when it sits in dist or build with a manifest', () => {
    expect(
      findNestedBuildFolders([
        'lib/dist/chrome/manifest.json',
        'lib/DIST/Firefox/manifest.json',
        'tools/build/edge/manifest.json',
        'build/safari/manifest.json',
        'src/chrome/manifest.json',
        'lib/dist/chrome/nested/manifest.json',
        'lib/dist/netscape/manifest.json',
        'lib/dist/manifest.json',
        'chrome/manifest.json'
      ])
    ).toEqual([
      'build/safari',
      'lib/DIST/Firefox',
      'lib/dist/chrome',
      'tools/build/edge'
    ])
  })

  it('tells an auth value from an environment reference', () => {
    const held = [
      `//registry.example.test/:_authToken=${TOKEN}`,
      `_auth=${TOKEN}`,
      `//registry.example.test/:_password="${TOKEN}"`,
      `  npmAuthToken: ${TOKEN}`,
      `npmAuthIdent: "user:${TOKEN}"`,
      `"//registry.example.test/:_authToken" "${TOKEN}"`,
      `_authToken=\${NPM_TOKEN}${TOKEN}`,
      `registry=https://registry.example.test/\r\n_authToken=${TOKEN}\r\n`
    ]
    const free = [
      '',
      'registry=https://registry.example.test/',
      `//registry.example.test/:_authToken=\${NPM_TOKEN}`,
      `_auth="\${NPM_AUTH}"`,
      `npmAuthToken: "\${NPM_TOKEN}" # set in CI`,
      `npmAuthToken: \${NPM_TOKEN:-}`,
      `npmAuthIdent: "\${NPM_USER}:\${NPM_PASSWORD}"`,
      '_authToken=',
      `# _authToken=${TOKEN}`,
      `; _authToken=${TOKEN}`,
      'always-auth=true',
      'npmAlwaysAuth: true'
    ]

    expect(held.filter((text) => !holdsRegistrySecret(text))).toEqual([])
    expect(free.filter((text) => holdsRegistrySecret(text))).toEqual([])
  })
})

describe('what the extension zip leaves out of the output folder', () => {
  let root: string
  let outPath: string
  let zipPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-left-out-'))
    outPath = path.join(root, 'dist', 'chrome')
    zipPath = path.join(root, 'dist', 'packed-1.0.0-chrome.zip')
    writeProject(root)
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    write(path.join(outPath, 'background.js'), 'BUILT')
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  const BUILT = ['background.js', 'manifest.json']

  it('leaves out the files an operating system writes, and says nothing', async () => {
    write(path.join(outPath, '.DS_Store'), 'FINDER')
    write(path.join(outPath, 'icons', 'Thumbs.db'), 'THUMBS')
    write(path.join(outPath, 'icons', 'DESKTOP.INI'), 'INI')
    write(path.join(outPath, 'icons', 'desktop.png'), 'SHIPPED')

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(zipPath)

    expect(Object.keys(packed).sort()).toEqual(
      [...BUILT, 'icons/desktop.png'].sort()
    )

    expect(warnings).toEqual([])
  })

  it('leaves out an env file copied into the output, and lists it', async () => {
    write(path.join(outPath, '.env'), `API=${TOKEN}`)
    write(path.join(outPath, 'config', '.env.local'), `API=${TOKEN}`)
    write(path.join(outPath, 'config', '.ENV.production'), `API=${TOKEN}`)
    write(path.join(outPath, '.env.example'), 'API=')
    write(path.join(outPath, 'env.js'), 'SHIPPED')

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(zipPath)

    expect(Object.keys(packed).sort()).toEqual(
      [...BUILT, '.env.example', 'env.js'].sort()
    )

    expect(everyByteOf(zipPath, packed)).not.toContain(TOKEN)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain(TOKEN)
    expect(warnings[0]).toMatch(
      /The extension zip left out what is not part of the extension/
    )

    expect(warnings[0]).toMatch(
      /ENV FILE\S* \.env, config\/\.ENV\.production, config\/\.env\.local\n/
    )
  })

  it('leaves out an archive of an earlier run, and lists it', async () => {
    write(path.join(outPath, 'packed-0.9.0-chrome.zip'), 'OLD')
    write(path.join(outPath, 'old', 'packed-0.9.0-source.zip'), 'OLD')
    write(path.join(outPath, 'assets', 'sample.zip'), 'SHIPPED')

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(zipPath)

    expect(Object.keys(packed).sort()).toEqual(
      [...BUILT, 'assets/sample.zip'].sort()
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(
      /OLD ARCHIVE\S* old\/packed-0\.9\.0-source\.zip, packed-0\.9\.0-chrome\.zip\n/
    )
  })

  // With the archive folder set to the output, the source zip lands in it.
  it('skips the source zip of the same run, and says nothing', async () => {
    const {warnings} = await zipProject(root, outPath, {
      zip: true,
      zipSource: true,
      zipDir: outPath
    })
    const packed = readZip(path.join(outPath, 'packed-1.0.0-chrome.zip'))

    expect(fs.existsSync(path.join(outPath, 'packed-1.0.0-source.zip'))).toBe(
      true
    )

    expect(Object.keys(packed).sort()).toEqual(BUILT)
    expect(warnings).toEqual([])
  })

  it('reads the same rules in either separator style', () => {
    expect(leftOutOfExtensionZip('icons\\Thumbs.db')).toBe('silent')
    expect(leftOutOfExtensionZip('icons/.DS_Store')).toBe('silent')
    expect(leftOutOfExtensionZip('config\\.env.local')).toEqual({
      reason: 'env',
      path: 'config/.env.local'
    })

    expect(leftOutOfExtensionZip('old\\app-1.0.0-edge.zip')).toEqual({
      reason: 'archive',
      path: 'old/app-1.0.0-edge.zip'
    })

    expect(leftOutOfExtensionZip('config\\.env.example')).toBeUndefined()
    expect(leftOutOfExtensionZip('assets\\sample.zip')).toBeUndefined()
  })
})
