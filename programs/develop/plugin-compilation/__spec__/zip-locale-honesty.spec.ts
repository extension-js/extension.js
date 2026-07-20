import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('adm-zip', () => {
  class ZipMock {
    static written: string[] = []
    addLocalFile(_file: string, _root?: string) {}
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

describe('ZipPlugin locale honesty (§73 F29)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-locale-'))
    ;(AdmZip as any).written = []
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('names the zip after the resolved __MSG_*__ name, not the placeholder slug', async () => {
    const outPath = path.join(tmp, 'dist', 'chrome')
    fs.mkdirSync(path.join(outPath, '_locales', 'en'), {recursive: true})
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: '__MSG_appName__',
        version: '2.0.0',
        default_locale: 'en'
      })
    )
    fs.writeFileSync(
      path.join(outPath, '_locales', 'en', 'messages.json'),
      JSON.stringify({appName: {message: 'Cool App'}})
    )

    const {compiler, emitDone} = makeCompiler(tmp, outPath)
    new ZipPlugin({browser: 'chrome', zipData: {zip: true}}).apply(compiler)
    const stats = await emitDone()

    expect(stats.compilation.warnings).toHaveLength(0)
    const written = (AdmZip as any).written as string[]
    expect(written).toHaveLength(1)
    expect(path.basename(written[0])).toBe('cool-app-2.0.0.zip')
  })

  it('warns with the missing default-locale root cause instead of an opaque zip failure', async () => {
    const outPath = path.join(tmp, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: '__MSG_appName__',
        version: '1.0.0',
        default_locale: 'en'
      })
    )

    const {compiler, emitDone} = makeCompiler(tmp, outPath)
    new ZipPlugin({browser: 'chrome', zipData: {zip: true}}).apply(compiler)
    const stats = await emitDone()

    const texts = stats.compilation.warnings.map((w: Error) => w.message)
    expect(texts.some((t: string) => t.includes('default_locale'))).toBe(true)
    expect(texts.some((t: string) => t.includes('_locales'))).toBe(true)
  })
})
