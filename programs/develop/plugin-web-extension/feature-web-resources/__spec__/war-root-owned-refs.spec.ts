import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveUserDeclaredWAR} from '../web-resources-lib/resolve-war'

const created: string[] = []

function srcProject(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'war-root-owned-'))
  )
  created.push(root)
  fs.mkdirSync(path.join(root, 'src'), {recursive: true})

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return {root, manifestPath: path.join(root, 'src', 'manifest.json')}
}

function compilationFor(root: string, assets: string[]) {
  const emitAsset = vi.fn()

  return {
    compilation: {
      options: {mode: 'production', context: root, output: {path: root}},
      outputOptions: {path: root},
      errors: [],
      warnings: [],
      assets: {},
      getAsset: (name: string) =>
        assets.includes(name) ? {name, source: {source: () => ''}} : undefined,
      emitAsset,
      fileDependencies: new Set<string>()
    } as unknown as Compilation,
    emitAsset
  }
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('web_accessible_resources that the project root owns', () => {
  it('names a compiled pages/ file at its root path from either spelling', () => {
    const {root, manifestPath} = srcProject({
      'src/manifest.json': '{}',
      'pages/frame.html': '<html></html>'
    })

    for (const spelling of ['pages/frame.html', '../pages/frame.html']) {
      const {compilation, emitAsset} = compilationFor(root, [
        'pages/frame.html'
      ])
      const resolved = resolveUserDeclaredWAR(
        compilation,
        manifestPath,
        {
          manifest_version: 3,
          web_accessible_resources: [
            {matches: ['<all_urls>'], resources: [spelling]}
          ]
        } as never,
        'chrome'
      )

      expect(Array.from(resolved.v3[0].resources)).toEqual(['pages/frame.html'])
      expect(emitAsset).not.toHaveBeenCalled()
      expect(compilation.warnings).toEqual([])
    }
  })

  it('ships a root file nothing compiled at its root path instead of a hashed slot', () => {
    const {root, manifestPath} = srcProject({
      'src/manifest.json': '{}',
      'docs/terms.txt': 'terms'
    })
    const {compilation, emitAsset} = compilationFor(root, [])

    const resolved = resolveUserDeclaredWAR(
      compilation,
      manifestPath,
      {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['../docs/terms.txt']}
        ]
      } as never,
      'chrome'
    )

    expect(Array.from(resolved.v3[0].resources)).toEqual(['docs/terms.txt'])
    expect(emitAsset).toHaveBeenCalledWith('docs/terms.txt', expect.anything())
    expect(compilation.warnings).toEqual([])
  })

  it('keeps a file beside the manifest on its manifest-relative path', () => {
    const {root, manifestPath} = srcProject({
      'src/manifest.json': '{}',
      'src/inject.css': 'body{}'
    })
    const {compilation, emitAsset} = compilationFor(root, [])

    const resolved = resolveUserDeclaredWAR(
      compilation,
      manifestPath,
      {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['inject.css']}
        ]
      } as never,
      'chrome'
    )

    expect(Array.from(resolved.v3[0].resources)).toEqual(['inject.css'])
    expect(emitAsset).toHaveBeenCalledWith('inject.css', expect.anything())
  })

  it('still warns and drops a ref that exists nowhere', () => {
    const {root, manifestPath} = srcProject({'src/manifest.json': '{}'})
    const {compilation} = compilationFor(root, [])

    const resolved = resolveUserDeclaredWAR(
      compilation,
      manifestPath,
      {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['pages/missing.html']}
        ]
      } as never,
      'chrome'
    )

    expect(resolved.v3.length).toBe(0)
    expect(compilation.warnings.length).toBe(1)
  })
})
