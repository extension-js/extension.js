import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import warnNoDefault from '../steps/setup-reload-strategy/add-content-script-wrapper/warn-no-default-export'

function runLoader(
  resourcePath: string,
  source: string,
  emitWarning = vi.fn()
) {
  const ctx: any = {
    resourcePath,
    emitWarning,
    getOptions() {
      return {manifestPath: '/abs/manifest.json', mode: 'development'}
    }
  }
  return warnNoDefault.call(ctx, source)
}

describe('loader:warn-no-default-export', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-'))
    manifestPath = path.join(tmp, 'manifest.json')
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('emits a warning when declared content script lacks default export', () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.js']}]})
    )
    const warn = vi.fn()
    const cs = path.join(tmp, 'cs.js')
    const ctx: any = {
      resourcePath: cs,
      emitWarning: warn,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const out = warnNoDefault.call(ctx, 'export const x = 1')
    expect(out).toContain('export const x = 1')
    expect(warn).toHaveBeenCalled()
  })

  it('does not warn when default export is present', () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.js']}]})
    )
    const warn = vi.fn()
    const cs = path.join(tmp, 'cs.js')
    const ctx: any = {
      resourcePath: cs,
      emitWarning: warn,
      getOptions() {
        return {manifestPath, mode: 'development'}
      }
    }
    const out = warnNoDefault.call(ctx, 'export default function(){}')
    expect(out).toContain('export default function')
    expect(warn).not.toHaveBeenCalled()
  })
})
