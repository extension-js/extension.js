import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeEach, afterEach, expect} from 'vitest'

const ctx = (resource: string, manifest: string) => ({
  resourcePath: resource,
  getOptions: () => ({
    manifestPath: manifest,
    mode: 'development',
    includeList: {},
    excludeList: {}
  })
})

describe('framework detection paths', () => {
  const tmpRoot = path.join(__dirname, '.tmp-fw')
  beforeEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
    fs.mkdirSync(tmpRoot, {recursive: true})
  })
  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  it('uses TS wrapper for .ts/.tsx when no framework deps', async () => {
    const projectDir = path.join(tmpRoot, 'p')
    const contentDir = path.join(projectDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})
    fs.writeFileSync(
      path.join(projectDir, 'manifest.json'),
      JSON.stringify({content_scripts: [{js: ['content/scripts.ts']}]})
    )
    const {default: loader} = await import(
      '../steps/add-content-script-wrapper'
    )
    const result = (loader as any).call(
      ctx(
        path.join(projectDir, 'content', 'scripts.ts'),
        path.join(projectDir, 'manifest.json')
      ),
      `export default function contentScript(){ return () => {} }`
    ) as string
    expect(result).toContain('TypeScript Content Script Wrapper')
  })

  it('uses JS wrapper for .js when no framework deps', async () => {
    const projectDir = path.join(tmpRoot, 'p2')
    const contentDir = path.join(projectDir, 'content')
    fs.mkdirSync(contentDir, {recursive: true})
    fs.writeFileSync(
      path.join(projectDir, 'manifest.json'),
      JSON.stringify({content_scripts: [{js: ['content/scripts.js']}]})
    )
    const {default: loader} = await import(
      '../steps/add-content-script-wrapper'
    )
    const result = (loader as any).call(
      ctx(
        path.join(projectDir, 'content', 'scripts.js'),
        path.join(projectDir, 'manifest.json')
      ),
      `export default function contentScript(){ return () => {} }`
    ) as string
    expect(result).toContain('JavaScript Content Script Wrapper')
  })
})
