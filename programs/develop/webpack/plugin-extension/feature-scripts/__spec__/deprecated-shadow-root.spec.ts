import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeEach, afterEach, expect} from 'vitest'

const makeCtx = (resourcePath: string, manifestPath: string) => ({
  resourcePath,
  getOptions: () => ({
    manifestPath
  })
})

describe('deprecated-shadow-root loader', () => {
  const tmpRoot = path.join(__dirname, '.tmp-deprecated')
  beforeEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
    fs.mkdirSync(tmpRoot, {recursive: true})
  })
  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  it('injects legacy CSS <link> when __EXTENSION_SHADOW_ROOT__ used', async () => {
    const projectDir = path.join(tmpRoot, 'p')
    const manifestPath = path.join(projectDir, 'manifest.json')
    fs.mkdirSync(projectDir, {recursive: true})
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['content/scripts.js']}]})
    )
    const {default: loader} = await import('../steps/deprecated-shadow-root')
    const ctx = makeCtx(
      path.join(projectDir, 'content', 'scripts.js'),
      manifestPath
    )
    const source = 'console.log(__EXTENSION_SHADOW_ROOT__)'

    const result = loader.call(ctx, source) as string

    expect(result).toContain('appendStyleElementForLegacyShadowRoot')
    expect(result).toContain('content_scripts/content-0.css')
  })
})
