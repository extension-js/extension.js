import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  chromiumExtensionId,
  chromiumExtensionIdFromKey,
  chromiumExtensionIdFromPath,
  chromiumExtensionIdFromRegisteredPath,
  geckoExtensionId,
  managedExtensionRecords
} from '../extension-id'

const devtoolsManifestPath = path.resolve(
  __dirname,
  '../../../../extensions/extension-js-devtools/src/manifest.json'
)

describe('chromium extension id derivation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-id-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('derives the pinned devtools companion id from its manifest key', () => {
    const manifest = JSON.parse(fs.readFileSync(devtoolsManifestPath, 'utf8'))
    const key = manifest['chromium:key']
    expect(typeof key).toBe('string')
    expect(chromiumExtensionIdFromKey(key)).toBe(
      'kgdaecdpfkikjncaalnmmnjjfpofkcbl'
    )
  })

  it('prefers the manifest key over the path', () => {
    const manifest = JSON.parse(fs.readFileSync(devtoolsManifestPath, 'utf8'))
    fs.writeFileSync(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1', key: manifest['chromium:key']})
    )

    expect(chromiumExtensionId(tmp)).toBe('kgdaecdpfkikjncaalnmmnjjfpofkcbl')
  })

  it.skipIf(process.platform === 'win32')(
    'derives the same id through a symlink as Chrome does from the real path (macOS /var vs /private/var, Windows registers the link itself)',
    () => {
      fs.writeFileSync(
        path.join(tmp, 'manifest.json'),
        JSON.stringify({name: 'x', version: '1'})
      )

      const linkRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'extension-id-link-')
      )
      const link = path.join(linkRoot, 'dist')

      try {
        fs.symlinkSync(tmp, link, 'dir')
        expect(fs.realpathSync.native(link)).not.toBe(link)
        expect(chromiumExtensionId(link)).toBe(
          chromiumExtensionIdFromPath(fs.realpathSync.native(tmp))
        )

        expect(chromiumExtensionId(link)).toBe(chromiumExtensionId(tmp))
      } finally {
        fs.rmSync(linkRoot, {recursive: true, force: true})
      }
    }
  )

  it('falls back to a deterministic path-derived id without a key', () => {
    fs.writeFileSync(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1'})
    )

    const id = chromiumExtensionId(tmp)
    expect(id).toBe(chromiumExtensionIdFromPath(tmp))
    expect(id).toMatch(/^[a-p]{32}$/)
    expect(chromiumExtensionId(tmp)).toBe(id)
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-id-other-'))

    try {
      expect(chromiumExtensionIdFromPath(other)).not.toBe(id)
    } finally {
      fs.rmSync(other, {recursive: true, force: true})
    }
  })
})

describe('gecko extension id derivation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-id-gecko-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('reads browser_specific_settings.gecko.id', () => {
    fs.writeFileSync(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({
        browser_specific_settings: {gecko: {id: 'devtools@extension.js'}}
      })
    )

    expect(geckoExtensionId(tmp)).toBe('devtools@extension.js')
  })

  it('falls back to applications.gecko.id', () => {
    fs.writeFileSync(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({applications: {gecko: {id: 'legacy@extension.js'}}})
    )

    expect(geckoExtensionId(tmp)).toBe('legacy@extension.js')
  })

  it('returns undefined without a pinned id', () => {
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({}))
    expect(geckoExtensionId(tmp)).toBeUndefined()
  })
})

describe('managedExtensionRecords', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-id-records-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('records absolute paths with chromium ids for chromium targets', () => {
    fs.writeFileSync(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1'})
    )

    const records = managedExtensionRecords('chromium', [tmp])
    expect(records).toEqual([
      {path: path.resolve(tmp), id: chromiumExtensionIdFromPath(tmp)}
    ])
  })

  it('records gecko ids for firefox targets and omits unknowable ids', () => {
    const pinned = path.join(tmp, 'pinned')
    const anonymous = path.join(tmp, 'anonymous')
    fs.mkdirSync(pinned)
    fs.mkdirSync(anonymous)
    fs.writeFileSync(
      path.join(pinned, 'manifest.json'),
      JSON.stringify({
        browser_specific_settings: {gecko: {id: 'devtools@extension.js'}}
      })
    )

    fs.writeFileSync(path.join(anonymous, 'manifest.json'), JSON.stringify({}))
    const records = managedExtensionRecords('firefox', [pinned, anonymous])
    expect(records).toEqual([
      {path: path.resolve(pinned), id: 'devtools@extension.js'},
      {path: path.resolve(anonymous)}
    ])
  })

  // Safari identity is the appex bundle id assigned at conversion, so a
  // chromium path hash would mislabel the record for webkit targets.
  it('omits ids for safari and webkit-based targets', () => {
    fs.writeFileSync(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1'})
    )

    expect(managedExtensionRecords('safari', [tmp])).toEqual([
      {path: path.resolve(tmp)}
    ])

    expect(managedExtensionRecords('webkit-based', [tmp])).toEqual([
      {path: path.resolve(tmp)}
    ])
  })
})

// Chrome hashes the wide path with only a lowercase drive letter upper-cased,
// so D:\Work\Ext and d:\Work\Ext share one id and D:\work\ext does not.
describe('the registered path rule', () => {
  const WINDOWS_PROJECT_ID = 'gmkbebnpnmepmednnlbgdgcdmpdejcbn'

  it('upper-cases a lowercase drive letter and hashes the UTF-16LE path on Windows', () => {
    expect(
      chromiumExtensionIdFromRegisteredPath('D:\\Work\\Ext', 'win32')
    ).toBe(WINDOWS_PROJECT_ID)

    expect(
      chromiumExtensionIdFromRegisteredPath('d:\\Work\\Ext', 'win32')
    ).toBe(WINDOWS_PROJECT_ID)

    expect(chromiumExtensionIdFromRegisteredPath('D:/Work/Ext', 'win32')).toBe(
      WINDOWS_PROJECT_ID
    )
  })

  it('keeps the case of every character after the drive letter', () => {
    expect(
      chromiumExtensionIdFromRegisteredPath('D:\\work\\ext', 'win32')
    ).not.toBe(WINDOWS_PROJECT_ID)
  })

  it('hashes the UTF-8 path unchanged elsewhere', () => {
    expect(chromiumExtensionIdFromRegisteredPath('/tmp/ext', 'linux')).toBe(
      'lcfjooiecahccmjaipimfaidcnaihadb'
    )

    expect(chromiumExtensionIdFromRegisteredPath('/tmp/ext', 'darwin')).toBe(
      'lcfjooiecahccmjaipimfaidcnaihadb'
    )
  })
})
