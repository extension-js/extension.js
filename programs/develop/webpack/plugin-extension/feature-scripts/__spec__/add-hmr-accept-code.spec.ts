import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeEach, afterEach, expect} from 'vitest'

// Minimal mock loader context
const makeLoaderContext = (resourcePath: string, manifestPath: string) => ({
  resourcePath,
  getOptions: () => ({
    manifestPath,
    mode: 'development',
    includeList: {},
    excludeList: {}
  })
})

const tmpRoot = path.join(__dirname, '.tmp-hmr')

describe('add-hmr-accept-code loader', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
    fs.mkdirSync(tmpRoot, {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  it('injects import.meta.webpackHot accept for content_scripts JS', async () => {
    const projectDir = path.join(tmpRoot, 'project-a')
    const contentDir = path.join(projectDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})
    const manifestPath = path.join(projectDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            js: ['content/scripts.js']
          }
        ]
      })
    )
    const resourcePath = path.join(projectDir, 'content', 'scripts.js')

    const {default: loader} = await import('../steps/add-hmr-accept-code')

    const ctx = makeLoaderContext(resourcePath, manifestPath)
    const source = 'export default function x(){}'
    // @ts-expect-error - calling loader with mocked context
    const result = loader.call(ctx, source) as string

    expect(result).toContain('import.meta.webpackHot')
    expect(result).toContain('accept')
  })

  it('injects import.meta.webpackHot accept for background.scripts JS', async () => {
    const projectDir = path.join(tmpRoot, 'project-b')
    fs.mkdirSync(projectDir, {recursive: true})
    const manifestPath = path.join(projectDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        background: {
          scripts: ['bg.js']
        }
      })
    )
    const resourcePath = path.join(projectDir, 'bg.js')

    const {default: loader} = await import('../steps/add-hmr-accept-code')

    const ctx = makeLoaderContext(resourcePath, manifestPath)
    const source = 'console.log("bg")'
    // @ts-expect-error - calling loader with mocked context
    const result = loader.call(ctx, source) as string

    expect(result).toContain('import.meta.webpackHot')
  })

  it('skips injection if source already contains import.meta.webpackHot (wrapper present)', async () => {
    const projectDir = path.join(tmpRoot, 'project-c')
    const contentDir = path.join(projectDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})
    const manifestPath = path.join(projectDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            js: ['content/scripts.js']
          }
        ]
      })
    )
    const resourcePath = path.join(projectDir, 'content', 'scripts.js')

    const {default: loader} = await import('../steps/add-hmr-accept-code')

    const ctx = makeLoaderContext(resourcePath, manifestPath)
    const source =
      'if (import.meta.webpackHot) { import.meta.webpackHot.accept() };\nconsole.log("foo")'
    // @ts-expect-error - calling loader with mocked context
    const result = loader.call(ctx, source) as string

    expect(result).toBe(source)
  })
})
