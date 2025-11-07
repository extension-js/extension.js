import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '')
  }
})

describe('isContentScriptEntry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })
  afterEach(() => {
    ;(fs.readFileSync as any).mockReset?.()
    ;(fs.existsSync as any).mockReset?.()
  })

  it('returns true when issuer matches a content script in manifest', async () => {
    const manifest = {content_scripts: [{js: ['content.js']}]} as any
    ;(fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(manifest))
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      String(p).endsWith('manifest.json')
    )
    const {isContentScriptEntry} = (await import(
      '../../css-lib/is-content-script'
    )) as any
    const path = require('path')
    const issuer = path.resolve('/project', 'content.js')
    const manifestPath = path.join('/project', 'manifest.json')
    expect(isContentScriptEntry(issuer, manifestPath)).toBe(true)
  })

  it('returns false for non-matching paths and early returns on missing args', async () => {
    const manifest = {content_scripts: [{js: ['a.js']}]} as any
    ;(fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(manifest))
    const {isContentScriptEntry} = (await import(
      '../../css-lib/is-content-script'
    )) as any
    expect(isContentScriptEntry('/x/b.js', '/x/manifest.json')).toBe(false)
    expect(isContentScriptEntry('', '')).toBe(false)
    expect(isContentScriptEntry('/x', '')).toBe(false)
    expect(isContentScriptEntry('', '/x/manifest.json')).toBe(false)
  })
})
