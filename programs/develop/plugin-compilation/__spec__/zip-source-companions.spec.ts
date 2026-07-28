import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('adm-zip', () => {
  class ZipMock {
    static added: string[] = []
    static written: string[] = []
    addLocalFile(file: string, root?: string) {
      ZipMock.added.push(
        root ? `${root}/${path.basename(file)}` : path.basename(file)
      )
    }
    addLocalFolder(_folder: string) {}
    writeZip(zipPath?: string) {
      if (zipPath) ZipMock.written.push(zipPath)
    }
  }
  return {default: ZipMock}
})

import AdmZip from 'adm-zip'
import {ZipPlugin} from '../zip'

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
    ;(AdmZip as any).added = []
    ;(AdmZip as any).written = []
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

    const added = (AdmZip as any).added as string[]
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

    const added = (AdmZip as any).added as string[]
    expect(added).toContain('extensions-helper.js')
    expect(added).toContain('src/extensions/util.js')
  })
})
