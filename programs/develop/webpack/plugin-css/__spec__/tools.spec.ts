import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs')
vi.stubEnv('EXTENSION_ENV', 'development')

describe('css tools detectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isContentScriptEntry detects content script issuers from manifest', async () => {
    const {isContentScriptEntry} = await import('../is-content-script')
    const manifestPath = '/project/manifest.json'
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({content_scripts: [{js: ['scripts/content.js']}]} as any)
    )

    const abs = '/project/scripts/content.js'
    expect(isContentScriptEntry(abs, manifestPath)).toBe(true)
    expect(isContentScriptEntry('/project/other.js', manifestPath)).toBe(false)
  })

  it('commonStyleLoaders adds postcss loader when using tailwind/postcss', async () => {
    vi.doMock('../css-tools/tailwind', () => ({isUsingTailwind: () => true}))
    vi.doMock('../css-tools/sass', () => ({isUsingSass: () => false}))
    vi.doMock('../css-tools/less', () => ({isUsingLess: () => false}))
    vi.doMock('../css-tools/postcss', () => ({
      maybeUsePostCss: vi.fn(async () => ({loader: 'postcss-loader'}))
    }))

    const {commonStyleLoaders} = await import('../common-style-loaders')
    const loaders = await commonStyleLoaders('/project', {mode: 'development'})
    expect(Array.isArray(loaders)).toBe(true)
    expect((loaders as any[])[0]?.loader).toBe('postcss-loader')
  })
})
