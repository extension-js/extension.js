import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../../../plugin-web-extension/feature-scripts/contracts'
import ensureHMRForScripts from '../../steps/ensure-hmr-for-scripts'

function makeLoaderCtx(options: any) {
  return {
    getOptions: () => options
  } as any
}

function runLoader(ctx: any, src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let wentAsync = false
    ctx.async = () => {
      wentAsync = true
      return (err: unknown, result?: string) =>
        err ? reject(err) : resolve(result as string)
    }
    const out = ensureHMRForScripts.call(ctx, src)
    if (!wentAsync) resolve(out as string)
  })
}

describe('ensureHMRForScripts loader', () => {
  let tmpDir = ''

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, {recursive: true, force: true})
      tmpDir = ''
    }
  })

  it('prepends HMR accept code', async () => {
    const src = 'console.log("x")'
    const out = await runLoader(makeLoaderCtx({manifestPath: '/m'}), src)
    expect(out).toContain('.accept()')
    expect(out).toContain(src)
  })

  it('injects the CJS module.hot guard into script-parsed (javascript/dynamic) modules', () => {
    const src = 'var I18N = {};'
    const out = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath: '/m'}),
        resourcePath: '/proj/i18n.js',
        resourceQuery:
          '?__extensionjs_classic_concat__=%7B%22feature%22%3A%22action%2Findex%22%7D',
        _module: {type: 'javascript/dynamic'}
      },
      src
    )
    expect(out).toContain('module.hot')
    expect(out).not.toContain('import.meta')
    expect(out).toContain(src)
  })

  it('keeps import.meta.webpackHot for esm parses', () => {
    const out = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath: '/m'}),
        resourcePath: '/proj/page.js',
        _module: {type: 'javascript/esm'}
      },
      'console.log("x")'
    )
    expect(out).toContain('import.meta.webpackHot')
  })

  it('keeps import.meta.webpackHot for auto parses whose source has module syntax', async () => {
    for (const src of [
      'import x from "./x"; console.log(x)',
      'export const a = 1',
      'console.log(import.meta.url)'
    ]) {
      const out = await runLoader(
        {
          getOptions: () => ({manifestPath: '/m'}),
          resourcePath: '/proj/page.js',
          _module: {type: 'javascript/auto'}
        },
        src
      )
      expect(out).toContain('import.meta.webpackHot')
      expect(out).toContain(src)
    }
  })

  it('injects module.hot into auto parses whose source is a classic script', async () => {
    for (const src of [
      'console.log("x")',
      'var data = "a\\1/NA\\2/NA";',
      'import("./lazy.js")'
    ]) {
      const out = await runLoader(
        {
          getOptions: () => ({manifestPath: '/m'}),
          resourcePath: '/proj/page.js',
          _module: {type: 'javascript/auto'}
        },
        src
      )
      expect(out).toContain('module.hot')
      expect(out).not.toContain('import.meta.webpackHot')
      expect(out).toContain(src)
    }
  })

  it('falls back to module.hot when the source cannot be lexed as a module', async () => {
    const out = await runLoader(
      {
        getOptions: () => ({manifestPath: '/m'}),
        resourcePath: '/proj/page.js',
        _module: {type: 'javascript/auto'}
      },
      'import {'
    )
    expect(out).toContain('module.hot')
    expect(out).not.toContain('import.meta.webpackHot')
  })

  it('skips Vue SFC virtual modules', () => {
    const src = 'console.log("x")'
    const out = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath: '/m'}),
        resourceQuery: '?vue&type=template&id=123'
      },
      src
    )
    expect(out).toBe(src)
  })

  it('skips declared content script entries', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-hmr-'))
    const manifestPath = path.join(tmpDir, 'manifest.json')
    const contentScriptPath = path.join(tmpDir, 'content.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['content.ts']}]})
    )
    fs.writeFileSync(contentScriptPath, 'console.log("content")')

    const src = 'console.log("content")'
    const out = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath}),
        resourcePath: contentScriptPath
      },
      src
    )
    expect(out).toBe(src)
  })

  it('skips modules in the content-script layer', () => {
    const src = 'console.log("layered")'
    const out = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath: '/m'}),
        resourcePath: '/proj/layered.ts',
        _module: {
          layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
        }
      },
      src
    )
    expect(out).toBe(src)
  })

  it('skips modules imported by declared content script entries', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-hmr-'))
    const manifestPath = path.join(tmpDir, 'manifest.json')
    const contentScriptPath = path.join(tmpDir, 'content.ts')
    const importedPath = path.join(tmpDir, 'imported.ts')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['content.ts']}]})
    )
    fs.writeFileSync(contentScriptPath, 'console.log("content")')
    fs.writeFileSync(importedPath, 'console.log("imported")')

    const src = 'console.log("imported")'
    const out = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath}),
        resourcePath: importedPath,
        _module: {
          issuer: {
            resource: contentScriptPath
          }
        }
      },
      src
    )
    expect(out).toBe(src)
  })
})
