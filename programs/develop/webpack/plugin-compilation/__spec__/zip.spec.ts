import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('adm-zip', () => {
  class ZipMock {
    files: Array<{file: string; root?: string}> = []
    addLocalFile(file: string, root?: string) {
      this.files.push({file, root})
    }
    addLocalFolder(_folder: string) {}
    writeZip(_path?: string) {}
  }
  return {default: ZipMock}
})

vi.mock('tiny-glob', () => ({
  default: vi.fn(async () => ['src/a.ts', 'src/b.ts', '.env', '.git/ignored'])
}))

vi.mock('ignore', () => ({
  default: () => {
    return {
      add: (_txt: string) => {},
      ignores: (file: string) => file.startsWith('.git/')
    }
  }
}))

vi.mock('fs', async () => {
  const actual: any = await vi.importActual('fs')
  return {
    ...actual,
    readFileSync: vi.fn((p: string) => {
      if (String(p).endsWith('manifest.json')) {
        return JSON.stringify({name: 'My App', version: '1.2.3'})
      }
      if (String(p).endsWith('.gitignore')) return 'node_modules\n.DS_Store'
      return ''
    })
  }
})

import AdmZip from 'adm-zip'
import {ZipPlugin} from '../zip'

function makeCompiler(ctx: string, outPath: string) {
  let doneCb: any
  const compiler: any = {
    options: {
      context: ctx,
      output: {path: outPath}
    },
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

describe('ZipPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates source zip at dirname(outPath) when zipSource=true', async () => {
    const {compiler, emitDone} = makeCompiler('/p/app', '/p/out/dist/chrome')
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zipSource: true},
      manifestPath: '/p/app/manifest.json'
    })
    plugin.apply(compiler)

    const spy = vi.spyOn((AdmZip as any).prototype, 'writeZip')
    const stats = await emitDone()
    expect(stats).toBeTruthy()
    expect(spy).toHaveBeenCalled()
    const out = String(spy.mock.calls[0][0])
    expect(out).toContain('/p/out/dist')
    expect(out).toContain('-source.zip')
  })

  it('creates dist zip at outPath when zip=true and respects zipFilename', async () => {
    const {compiler, emitDone} = makeCompiler('/p/app', '/p/out/dist/edge')
    const plugin = new ZipPlugin({
      browser: 'edge',
      zipData: {zip: true, zipFilename: 'My File Name'}
    })
    plugin.apply(compiler)

    const spy = vi.spyOn((AdmZip as any).prototype, 'writeZip')
    await emitDone()
    expect(spy).toHaveBeenCalled()
    const out = String(spy.mock.calls[0][0])
    expect(out).toContain('/p/out/dist/edge/')
    expect(out).toMatch(/my-file-name\.zip$/)
  })

  it('pushes warning on error without throwing', async () => {
    const {compiler, emitDone} = makeCompiler('/p/app', '/p/out/dist/chrome')
    const plugin = new ZipPlugin({
      browser: 'chrome',
      zipData: {zip: true}
    })

    const fs = await import('fs')
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('fail-read')
    })

    plugin.apply(compiler)
    const stats = await emitDone({compilation: {warnings: []}})
    expect(stats.compilation.warnings.length).toBe(1)
    expect(String(stats.compilation.warnings[0].message)).toMatch(
      /ZipPlugin: Failed/
    )
  })
})
