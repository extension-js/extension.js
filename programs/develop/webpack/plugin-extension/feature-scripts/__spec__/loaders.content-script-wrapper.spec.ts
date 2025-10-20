import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import wrapper from '../steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper'

function runLoader(resourcePath: string, source: string) {
  const ctx: any = {
    resourcePath,
    getOptions() {
      return {manifestPath: '/abs/manifest.json', mode: 'development'}
    }
  }
  return wrapper.call(ctx, source)
}

describe('loader:content-script-wrapper', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csw-'))
    manifestPath = path.join(tmp, 'manifest.json')
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('adds console marker only for declared content scripts', () => {
    const cs = path.join(tmp, 'cs.js')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.js']}]})
    )
    const ctx1: any = {
      resourcePath: cs,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const outDeclared = wrapper.call(ctx1, 'console.log(1)')
    expect(outDeclared).toMatch('content-script-wrapper active')

    const other = path.join(tmp, 'other.js')
    fs.writeFileSync(other, '')
    const ctx2: any = {
      resourcePath: other,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const outOther = wrapper.call(ctx2, 'console.log(2)')
    expect(outOther).not.toMatch('content-script-wrapper active')
  })
})
