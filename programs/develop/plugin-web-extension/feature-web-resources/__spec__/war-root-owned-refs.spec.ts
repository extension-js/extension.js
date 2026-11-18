import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  declaredResourceSource,
  resolveUserDeclaredWAR
} from '../web-resources-lib/resolve-war'

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

function compilationFor(
  root: string,
  assets: string[],
  sources: Record<string, string> = {}
) {
  const emitAsset = vi.fn()
  const assetFor = (name: string) => ({
    name,
    source: {source: () => sources[name] ?? ''}
  })

  return {
    compilation: {
      options: {mode: 'production', context: root, output: {path: root}},
      outputOptions: {path: root},
      errors: [],
      warnings: [],
      assets: {},
      getAsset: (name: string) =>
        assets.includes(name) ? assetFor(name) : undefined,
      getAssets: () => assets.map(assetFor),
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

  it('ships a root file nothing names in the bundler-named slot', () => {
    const {root, manifestPath} = srcProject({
      'src/manifest.json': '{}',
      'docs/terms.txt': 'terms'
    })
    const {compilation, emitAsset} = compilationFor(root, ['background.js'], {
      'background.js': "console.log(chrome.runtime.getURL('docs/other.txt'))"
    })

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

    const [resource] = Array.from(resolved.v3[0].resources)
    expect(resource).toMatch(/^assets\/terms\.[0-9a-f]{8}\.txt$/)
    expect(emitAsset).toHaveBeenCalledWith(resource, expect.anything())
    expect(emitAsset).not.toHaveBeenCalledWith(
      'docs/terms.txt',
      expect.anything()
    )

    expect(compilation.warnings).toEqual([])
  })

  it('ships a root file at its root path when the manifest spells that path', () => {
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
          {matches: ['<all_urls>'], resources: ['docs/terms.txt']}
        ]
      } as never,
      'chrome'
    )

    expect(Array.from(resolved.v3[0].resources)).toEqual(['docs/terms.txt'])
    expect(emitAsset).toHaveBeenCalledWith('docs/terms.txt', expect.anything())
    expect(compilation.warnings).toEqual([])
  })

  it('ships a root file at its root path when a runtime.getURL literal names it', () => {
    const {root, manifestPath} = srcProject({
      'src/manifest.json': '{}',
      'docs/terms.txt': 'terms'
    })
    const {compilation, emitAsset} = compilationFor(root, ['background.js'], {
      'background.js': "fetch(chrome.runtime.getURL('/docs/terms.txt'))"
    })

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

describe('web_accessible_resources of a manifest below the project root', () => {
  // Obvious fakes: no file here holds a real value.
  const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'

  function holderProject() {
    const holder = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'war-root-edge-'))
    )
    created.push(holder)

    const files: Record<string, string> = {
      'outside.txt': `${MARKER}-outside`,
      'project/.env': `PRIVATE_KEY=${MARKER}-env`,
      'project/node_modules/pkg/data.json': `"${MARKER}-package"`,
      'project/docs/terms.txt': 'terms',
      'project/src/manifest.json': '{}',
      'project/src/.npmrc': `# ${MARKER}-npmrc`,
      'project/src/beside.txt': 'beside'
    }

    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(holder, rel)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, content)
    }

    const root = path.join(holder, 'project')

    return {root, manifestPath: path.join(root, 'src', 'manifest.json')}
  }

  const WITHHELD = [
    '.env',
    '../.env',
    '.npmrc',
    'node_modules/pkg/data.json',
    '../node_modules/pkg/data.json',
    '../../outside.txt',
    '../docs/../../outside.txt'
  ]

  it('copies nothing the project root does not own and reports each entry', () => {
    const {root, manifestPath} = holderProject()
    const {compilation, emitAsset} = compilationFor(root, [])
    const resolved = resolveUserDeclaredWAR(
      compilation,
      manifestPath,
      {
        manifest_version: 3,
        web_accessible_resources: [
          {
            matches: ['<all_urls>'],
            resources: [...WITHHELD, '../docs/terms.txt', 'beside.txt']
          }
        ]
      } as never,
      'chrome'
    )

    const shipped = ['assets/terms.<hash>.txt', 'beside.txt']
    const withoutHash = (name: string) =>
      name.replace(/\.[0-9a-f]{8}(?=\.)/, '.<hash>')

    expect(
      emitAsset.mock.calls.map(([name]) => withoutHash(String(name))).sort()
    ).toEqual(shipped)

    expect(
      Array.from(resolved.v3[0].resources).map(withoutHash).sort()
    ).toEqual(shipped)

    const said = compilation.warnings.map((warning) => String(warning.message))

    expect(said).toHaveLength(WITHHELD.length)

    for (const [index, entry] of WITHHELD.entries()) {
      expect(said[index]).toContain(`Can't find the file`)
      expect(said[index]).toContain(entry)
      expect(said[index]).not.toContain(MARKER)
      expect((compilation.warnings[index] as {name?: string}).name).toBe(
        'WARRelativeAssetMissing'
      )
    }
  })

  it('names no source file for an entry the build withholds', () => {
    const {root, manifestPath} = holderProject()

    for (const entry of WITHHELD) {
      expect(declaredResourceSource(manifestPath, root, entry), entry).toBe(
        undefined
      )
    }

    expect(declaredResourceSource(manifestPath, root, 'beside.txt')).toEqual({
      source: path.join(root, 'src', 'beside.txt'),
      output: 'beside.txt'
    })
  })
})
