import fs from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, describe, it, expect} from 'vitest'
import ensureHMRForScripts from '../../steps/ensure-hmr-for-scripts'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../../../plugin-web-extension/feature-scripts/contracts'

function makeLoaderCtx(options: any) {
  return {
    getOptions: () => options
  } as any
}

describe('ensureHMRForScripts loader', () => {
  let tmpDir = ''

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, {recursive: true, force: true})
      tmpDir = ''
    }
  })

  it('prepends HMR accept code', () => {
    const src = 'console.log("x")'
    const out = ensureHMRForScripts.call(
      makeLoaderCtx({manifestPath: '/m'}),
      src
    )
    expect(out).toContain('import.meta.webpackHot')
    expect(out).toContain(src)
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
