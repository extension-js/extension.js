import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../browsers-lib/messages'
import {
  packageSafariExtension,
  type SafariPipelineMode
} from '../run-safari/safari-launch'
import {findAppIconSets} from '../run-safari/safari-launch/app-icon'
import {
  composeProjectFingerprint,
  isProjectStale,
  resolveSafariBuildConfig
} from '../run-safari/safari-launch/safari-config'
import {resizePngArgs} from '../run-safari/safari-launch/tools'
import {
  CONVERTER_PLATE,
  type FakeSafariTools,
  fakeSafariTools
} from './safari-fake-tools'

// A supplied app icon (ledger 356): the converter builds the macOS icon set
// from the manifest icons and sets them on a white plate, so a project whose
// icon already is a rounded tile shipped a tile inside a tile. With appIcon the
// set is made from that file as it is, and without it the set stays the
// converter's own.

let root: string
let distDir: string

function pngHeader(width: number, height: number, mark: string): Buffer {
  const bytes = Buffer.alloc(33 + mark.length)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes.write(mark, 33, 'ascii')

  return bytes
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-app-icon-'))
  distDir = path.join(root, 'dist', 'safari')
  fs.mkdirSync(distDir, {recursive: true})
  fs.writeFileSync(
    path.join(distDir, 'manifest.json'),
    JSON.stringify({name: 'Rebeccat', version: '0.3.0'})
  )

  fs.writeFileSync(
    path.join(root, 'app-icon.png'),
    pngHeader(1024, 1024, 'tile')
  )

  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, {recursive: true, force: true})
})

async function run(
  tools: FakeSafariTools,
  host: Record<string, unknown> = {},
  mode: SafariPipelineMode = 'full'
) {
  const lines: string[] = []
  const push = (m: string) => lines.push(String(m))

  await packageSafariExtension(
    {
      extension: [distDir],
      browser: 'safari',
      noOpen: true,
      tools,
      ...host
    } as any,
    distDir,
    {info: push, warn: push, error: push, debug: () => {}} as any,
    mode
  )

  return lines
}

function iconSet(): string {
  const [set] = findAppIconSets(path.join(`${distDir}-xcode`, 'Rebeccat'))

  return set
}

describe('the Safari app icon', () => {
  it('makes the icon set from the supplied PNG as it is, with no plate', async () => {
    const tools = fakeSafariTools()
    const source = path.join(root, 'app-icon.png')
    const lines = await run(tools, {appIcon: source})
    const set = iconSet()
    const read = (file: string) => fs.readFileSync(path.join(set, file))

    expect(set).toBe(
      path.join(
        `${distDir}-xcode`,
        'Rebeccat',
        'Rebeccat',
        'Assets.xcassets',
        'AppIcon.appiconset'
      )
    )

    expect(read('mac-icon-512@2x.png').equals(fs.readFileSync(source))).toBe(
      true
    )

    expect(read('mac-icon-16@1x.png').toString()).toBe(
      'sips 16 px of app-icon.png'
    )

    expect(read('mac-icon-32@1x.png').toString()).toBe(
      'sips 32 px of app-icon.png'
    )

    expect(read('mac-icon-16@2x.png').toString()).toBe(
      'sips 32 px of app-icon.png'
    )

    for (const file of fs.readdirSync(set)) {
      expect(read(file).toString()).not.toContain(CONVERTER_PLATE)
    }

    expect(tools.calls.resizePng.map(([, , px]) => px)).toEqual([
      16, 32, 64, 128, 256, 512
    ])

    expect(tools.events.indexOf('sips')).toBeGreaterThan(
      tools.events.indexOf('converter')
    )

    expect(tools.events.indexOf('xcodebuild')).toBeGreaterThan(
      tools.events.lastIndexOf('sips')
    )

    expect(lines).toContain(messages.safariAppIconApplied(source, 10))
    expect(lines).not.toContain(messages.safariAppIconFromManifest())
  })

  it('leaves the converter set alone without appIcon and says how to supply one', async () => {
    const tools = fakeSafariTools()
    const lines = await run(tools)
    const set = iconSet()

    expect(fs.readFileSync(path.join(set, 'mac-icon-512@2x.png'), 'utf8')).toBe(
      CONVERTER_PLATE
    )

    expect(tools.calls.resizePng).toEqual([])
    expect(lines).toContain(messages.safariAppIconFromManifest())
    expect(messages.safariAppIconFromManifest()).toContain(
      'browser.safari.appIcon'
    )
  })

  it('refuses an icon that is not square before xcodebuild runs', async () => {
    const tools = fakeSafariTools()
    const source = path.join(root, 'wide.png')
    fs.writeFileSync(source, pngHeader(1024, 512, 'wide'))

    await expect(run(tools, {appIcon: source})).rejects.toThrow(
      `${source} is 1024x512, and the app icon must be square`
    )

    expect(tools.calls.xcodebuild).toEqual([])
  })

  it('warns when the supplied icon is smaller than 1024 px', async () => {
    const tools = fakeSafariTools()
    const source = path.join(root, 'small.png')
    fs.writeFileSync(source, pngHeader(512, 512, 'small'))

    const lines = await run(tools, {appIcon: source})

    expect(lines).toContain(messages.safariAppIconSmall(source, 512, 1024))
    expect(
      fs.readFileSync(path.join(iconSet(), 'mac-icon-512@1x.png'))
    ).toEqual(fs.readFileSync(source))
  })

  it('regenerates when the icon bytes change or the option goes, and keeps old fingerprints', () => {
    const source = path.join(root, 'app-icon.png')
    const host = {extension: [distDir], browser: 'safari'} as any
    const compilation = {options: {output: {path: distDir}}} as any
    const plain = resolveSafariBuildConfig(compilation, host)
    const withIcon = resolveSafariBuildConfig(compilation, {
      ...host,
      appIcon: source
    })

    expect(composeProjectFingerprint(plain)).not.toContain('appIcon')

    fs.mkdirSync(withIcon.projectLocation, {recursive: true})
    fs.writeFileSync(
      path.join(withIcon.projectLocation, '.manifest-fingerprint'),
      composeProjectFingerprint(withIcon)
    )

    expect(isProjectStale(withIcon)).toBe(false)

    fs.writeFileSync(source, pngHeader(1024, 1024, 'new tile'))

    expect(isProjectStale(withIcon)).toBe(true)

    fs.writeFileSync(
      path.join(withIcon.projectLocation, '.manifest-fingerprint'),
      composeProjectFingerprint(withIcon)
    )

    expect(isProjectStale(plain)).toBe(true)
  })

  it('scales with sips, which opens no window', () => {
    expect(resizePngArgs('/a/icon.png', '/b/16.png', 16)).toEqual([
      '-z',
      '16',
      '16',
      '/a/icon.png',
      '--out',
      '/b/16.png'
    ])
  })
})
