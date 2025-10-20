import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import addHmrAccept from '../steps/setup-reload-strategy/add-content-script-wrapper/add-hmr-accept-code'

function runLoader(resourcePath: string, source: string) {
  const ctx: any = {
    resourcePath,
    getOptions() {
      return {manifestPath: '/abs/manifest.json', mode: 'development'}
    }
  }
  return addHmrAccept.call(ctx, source)
}

describe('loader:add-hmr-accept-code', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hmr-'))
    manifestPath = path.join(tmp, 'manifest.json')
    addHmrAccept as any // keep TS happy
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('injects HMR for background.scripts files', () => {
    const bg = path.join(tmp, 'bg.js')
    fs.writeFileSync(bg, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({background: {scripts: ['bg.js']}})
    )
    const ctx: any = {
      resourcePath: bg,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const out = addHmrAccept.call(ctx, 'console.log(1)')
    expect(out).toMatch('Extension.js HMR registration')
    expect(out).toMatch('import.meta.webpackHot.accept')
  })

  it('injects HMR for user_scripts files', () => {
    const us = path.join(tmp, 'user.js')
    fs.writeFileSync(us, '')
    fs.writeFileSync(manifestPath, JSON.stringify({user_scripts: ['user.js']}))
    const ctx: any = {
      resourcePath: us,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const out = addHmrAccept.call(ctx, 'console.log(2)')
    expect(out).toMatch('Extension.js HMR registration')
  })

  it('does not inject when HMR is already present', () => {
    fs.writeFileSync(manifestPath, JSON.stringify({}))
    const anyJs = path.join(tmp, 'any.js')
    fs.writeFileSync(anyJs, '')
    const src =
      'if (import.meta.webpackHot) { import.meta.webpackHot.accept() }'
    const ctx: any = {
      resourcePath: anyJs,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const out = addHmrAccept.call(ctx, src)
    expect(out).toBe(src)
  })
})
