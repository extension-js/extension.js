import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
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

describe('what the source zip packs today beside the source', () => {
  let root: string
  let outPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-left-out-'))
    outPath = path.join(root, 'dist', 'chrome')
    writeProject(root)
    fs.mkdirSync(outPath, {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  async function sourceZip() {
    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    return {warnings, packed, names: Object.keys(packed).sort()}
  }

  it('packs a signing key and a packed extension', async () => {
    write(path.join(root, 'key.pem'), KEY)
    write(path.join(root, 'certs', 'KEY.PEM'), KEY)
    write(path.join(root, 'release', 'packed.crx'), KEY)
    write(path.join(root, 'certs', 'store.p12'), KEY)
    write(path.join(root, 'deploy', 'id_rsa'), KEY)

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual(
      [
        ...SOURCE,
        'certs/KEY.PEM',
        'certs/store.p12',
        'deploy/id_rsa',
        'key.pem',
        'release/packed.crx'
      ].sort()
    )

    expect(packed['key.pem']).toBe(KEY)
    expect(warnings).toEqual([])
  })

  it('packs a registry file that holds an auth value', async () => {
    write(
      path.join(root, '.npmrc'),
      `//registry.example.test/:_authToken=${TOKEN}\n`
    )

    write(
      path.join(root, '.yarnrc.yml'),
      `npmRegistryServer: "https://registry.example.test"\nnpmAuthToken: "${TOKEN}"\n`
    )

    const {warnings, packed, names} = await sourceZip()

    expect(names).toEqual(['.npmrc', '.yarnrc.yml', ...SOURCE])
    expect(packed['.npmrc']).toContain(TOKEN)
    expect(warnings).toEqual([])
  })

  it('packs the files an operating system leaves in a folder', async () => {
    write(path.join(root, '.DS_Store'), 'FINDER')
    write(path.join(root, 'src', 'Thumbs.db'), 'THUMBS')
    write(path.join(root, 'src', 'icons', 'desktop.ini'), 'INI')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(
      [...SOURCE, '.DS_Store', 'src/Thumbs.db', 'src/icons/desktop.ini'].sort()
    )

    expect(warnings).toEqual([])
  })

  it('packs the folders a tool keeps for one machine', async () => {
    write(path.join(root, '.claude', 'settings.local.json'), '{}')
    write(path.join(root, 'packages', 'site', '.vercel', 'project.json'), '{}')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(
      [
        ...SOURCE,
        '.claude/settings.local.json',
        'packages/site/.vercel/project.json'
      ].sort()
    )

    expect(warnings).toEqual([])
  })

  it('packs the archives of earlier runs', async () => {
    write(path.join(root, 'web-ext-artifacts', 'packed-0.9.0.zip'), 'OLD')
    write(path.join(root, 'releases', 'packed-0.9.0-chrome.zip'), 'OLD')
    write(path.join(root, 'releases', 'packed-0.9.0-source.zip'), 'OLD')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(
      [
        ...SOURCE,
        'releases/packed-0.9.0-chrome.zip',
        'releases/packed-0.9.0-source.zip',
        'web-ext-artifacts/packed-0.9.0.zip'
      ].sort()
    )

    expect(warnings).toEqual([])
  })

  it('packs a nested build folder that holds no session folder', async () => {
    write(path.join(root, 'lib', 'dist', 'chrome', 'manifest.json'), 'OLD')
    write(path.join(root, 'lib', 'dist', 'chrome', 'background.js'), 'OLD')

    const {warnings, names} = await sourceZip()

    expect(names).toEqual(
      [
        ...SOURCE,
        'lib/dist/chrome/background.js',
        'lib/dist/chrome/manifest.json'
      ].sort()
    )

    expect(warnings).toEqual([])
  })
})

describe('what the extension zip packs today beside the build', () => {
  let root: string
  let outPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-left-out-'))
    outPath = path.join(root, 'dist', 'chrome')
    writeProject(root)
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    write(path.join(outPath, 'background.js'), 'BUILT')
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('packs OS files, env files and old archives found in the output', async () => {
    write(path.join(outPath, '.DS_Store'), 'FINDER')
    write(path.join(outPath, 'icons', 'Thumbs.db'), 'THUMBS')
    write(path.join(outPath, '.env'), `API=${TOKEN}`)
    write(path.join(outPath, 'packed-0.9.0-chrome.zip'), 'OLD')
    write(path.join(outPath, 'packed-0.9.0-source.zip'), 'OLD')

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-chrome.zip'))

    expect(Object.keys(packed).sort()).toEqual(
      [
        '.DS_Store',
        '.env',
        'background.js',
        'icons/Thumbs.db',
        'manifest.json',
        'packed-0.9.0-chrome.zip',
        'packed-0.9.0-source.zip'
      ].sort()
    )

    expect(packed['.env']).toContain(TOKEN)
    expect(warnings).toEqual([])
  })
})
