import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach, vi} from 'vitest'
import contentLoader from '../steps/add-centralized-logger-script/logger-script'
import backgroundLoader from '../steps/add-centralized-logger-script/logger-background'

function runContent(
  resourcePath: string,
  source: string,
  manifestPathArg: string
) {
  const ctx: any = {
    resourcePath,
    emitFile: vi.fn(),
    getOptions() {
      return {manifestPath: manifestPathArg, browser: 'chrome'}
    }
  }
  return contentLoader.call(ctx, source)
}

function runBackground(resourcePath: string, source: string) {
  const ctx: any = {
    resourcePath,
    getOptions() {
      return {manifestPath: '/abs/manifest.json', browser: 'chrome'}
    }
  }
  return backgroundLoader.call(ctx, source)
}

describe('add-centralized-logger-script loaders', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-'))
    manifestPath = path.join(tmp, 'manifest.json')
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it.skip('injects content logger only for declared content scripts', () => {
    const cs = path.join(tmp, 'cs.js')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.js']}], background: {}})
    )
    const out1 = runContent(cs, 'console.log(1)', manifestPath)
    expect(out1).toMatch('centralized content logger bootstrap')

    const other = path.join(tmp, 'other.js')
    fs.writeFileSync(other, '')
    const out2 = contentLoader.call(
      {
        resourcePath: other,
        getOptions() {
          return {manifestPath, browser: 'chrome'}
        }
      },
      'console.log(2)'
    )
    expect(out2).not.toMatch('centralized content logger bootstrap')
  })

  it('injects background logger for background scripts and service_worker', () => {
    // MV2 scripts
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({background: {scripts: ['bg.js']}})
    )
    const bg = path.join(tmp, 'bg.js')
    fs.writeFileSync(bg, '')
    const outBg = backgroundLoader.call(
      {
        resourcePath: bg,
        getOptions() {
          return {manifestPath, browser: 'chrome'}
        }
      },
      'console.log("bg")'
    )
    expect(outBg).toMatch('centralized background logger bootstrap')

    // MV3 service worker
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({background: {service_worker: 'sw.js'}})
    )
    const sw = path.join(tmp, 'sw.js')
    fs.writeFileSync(sw, '')
    const outSw = backgroundLoader.call(
      {
        resourcePath: sw,
        getOptions() {
          return {manifestPath, browser: 'chrome'}
        }
      },
      'console.log("sw")'
    )
    expect(outSw).toMatch('centralized background logger bootstrap')
  })
})
