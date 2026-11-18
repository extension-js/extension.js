import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ZipPlugin} from '../zip'
import {readZip, zipProject} from './helpers/zip-archive'

function readZipEntries(zipPath: string): string[] {
  return Object.keys(unzipSync(new Uint8Array(fs.readFileSync(zipPath))))
}

function makeCompiler(ctx: string, outPath: string) {
  let doneCb: any
  const compiler: any = {
    options: {context: ctx, output: {path: outPath}},
    hooks: {
      done: {
        tapPromise: (_name: string, cb: any) => {
          doneCb = cb
        }
      }
    }
  }

  return {
    compiler,
    emitDone: async (stats: any = {compilation: {warnings: []}}) => {
      await doneCb(stats)

      return stats
    }
  }
}

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

describe('a source zip never carries a companion extension', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-companions-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
    vi.restoreAllMocks()
  })

  it('leaves ./extensions out even when nothing gitignores it', async () => {
    const outPath = path.join(tmp, 'dist', 'chrome')
    write(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({name: 'Mine', version: '1.0.0', manifest_version: 3})
    )

    write(path.join(tmp, 'src', 'popup.js'), 'console.log(1)')
    write(
      path.join(tmp, 'extensions', 'a-companion', 'manifest.json'),
      JSON.stringify({
        name: 'Companion',
        version: '0.0.1',
        manifest_version: 3,
        host_permissions: ['<all_urls>']
      })
    )

    write(
      path.join(tmp, 'extensions', 'a-companion', 'background.js'),
      'chrome.cookies.getAll({}, () => {})'
    )

    fs.mkdirSync(outPath, {recursive: true})

    const {compiler, emitDone} = makeCompiler(tmp, outPath)
    new ZipPlugin({
      browser: 'chrome',
      zipData: {zipSource: true}
    }).apply(compiler)

    await emitDone()

    const added = readZipEntries(
      path.join(tmp, 'dist', 'mine-1.0.0-source.zip')
    )
    expect(added).toContain('manifest.json')
    expect(added).toContain('src/popup.js')
    expect(added.some((entry) => entry.includes('a-companion'))).toBe(false)
    expect(added.some((entry) => entry.startsWith('extensions/'))).toBe(false)
  })

  it('keeps a source file whose own name merely starts with extensions', async () => {
    const outPath = path.join(tmp, 'dist', 'chrome')
    write(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({name: 'Mine', version: '1.0.0', manifest_version: 3})
    )

    write(path.join(tmp, 'extensions-helper.js'), 'export const a = 1')
    write(path.join(tmp, 'src', 'extensions', 'util.js'), 'export const b = 2')
    fs.mkdirSync(outPath, {recursive: true})

    const {compiler, emitDone} = makeCompiler(tmp, outPath)
    new ZipPlugin({
      browser: 'chrome',
      zipData: {zipSource: true}
    }).apply(compiler)

    await emitDone()

    const added = readZipEntries(
      path.join(tmp, 'dist', 'mine-1.0.0-source.zip')
    )
    expect(added).toContain('extensions-helper.js')
    expect(added).toContain('src/extensions/util.js')
  })
})

// The project is one folder under ./extensions and the root has no manifest.
describe('a source zip of a project that lives under ./extensions', () => {
  let tmp: string
  let outPath: string

  const NESTED = JSON.stringify({
    name: 'Nested',
    version: '1.0.0',
    manifest_version: 3
  })

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-companions-'))
    outPath = path.join(tmp, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  async function sourceZip(manifestPath: string) {
    const {warnings} = await zipProject(
      tmp,
      outPath,
      {zipSource: true},
      manifestPath
    )
    const zipPath = path.join(tmp, 'dist', 'nested-1.0.0-source.zip')

    return {warnings, names: Object.keys(readZip(zipPath)).sort()}
  }

  it('writes an empty archive and says nothing', async () => {
    const manifestPath = path.join(tmp, 'extensions', 'my-ext', 'manifest.json')
    write(manifestPath, NESTED)
    write(path.join(tmp, 'extensions', 'my-ext', 'bg.js'), 'OWN')
    write(path.join(tmp, 'extensions', 'other-ext', 'manifest.json'), NESTED)
    write(path.join(tmp, 'extensions', 'other-ext', 'bg.js'), 'OTHER')

    const {warnings, names} = await sourceZip(manifestPath)

    expect(names).toEqual([])
    expect(warnings).toEqual([])
  })

  it('writes an empty archive for a manifest directly in ./extensions', async () => {
    const manifestPath = path.join(tmp, 'extensions', 'manifest.json')
    write(manifestPath, NESTED)
    write(path.join(tmp, 'extensions', 'bg.js'), 'OWN')

    const {warnings, names} = await sourceZip(manifestPath)

    expect(names).toEqual([])
    expect(warnings).toEqual([])
  })
})
