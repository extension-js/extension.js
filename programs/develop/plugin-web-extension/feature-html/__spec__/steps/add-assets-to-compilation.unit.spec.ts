import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

function makeCompilation() {
  const assets: Record<string, any> = {}
  const compilationObj: any = {
    options: {mode: 'production'},
    getAsset: (name: string) => assets[name],
    assets,
    errors: [],
    warnings: [] as any[],
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    emitAsset: (name: string, src: any) => {
      assets[name] = {
        source: {source: () => (src.source ? src.source() : src)}
      }
    }
  }
  return {
    options: {mode: 'production'},
    getAsset: (name: string) => assets[name],
    assets,
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}
    }
  }
}

describe('AddAssetsToCompilation', () => {
  it('emits public-root static assets preserving structure', () => {
    const tmp = path.join(__dirname, '.tmp-assets')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}', 'utf8')
    const publicDir = path.join(tmp, 'public')
    fs.mkdirSync(publicDir, {recursive: true})
    const favicon = path.join(publicDir, 'favicon.png')
    fs.writeFileSync(favicon, 'x')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(
      html,
      `<html><head><link rel="icon" href="/favicon.png"></head><body></body></html>`
    )
    const c = makeCompilation()
    ;(c as any).assets[path.basename(html)] = {
      source: {source: () => fs.readFileSync(html).toString()}
    }
    new AddAssetsToCompilation({
      manifestPath,
      includeList: {'feature/index': html}
    } as any).apply(c as any)
    expect((c as any).assets['favicon.png']).toBeUndefined()
  })

  describe('missing local refs: Chrome silently 404s them', () => {
    function makeCompilationWithDiagnostics() {
      const assets: Record<string, any> = {}
      const compilationObj: any = {
        options: {mode: 'production'},
        getAsset: (name: string) => assets[name],
        assets,
        errors: [] as any[],
        warnings: [] as any[],
        hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
        emitAsset: (name: string, src: any) => {
          assets[name] = {
            source: {source: () => (src.source ? src.source() : src)}
          }
        }
      }
      const compiler = {
        options: {mode: 'production'},
        hooks: {thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}}
      }
      return {compiler, compilation: compilationObj}
    }

    function writeDeadRefFixture(name: string) {
      const tmp = path.join(__dirname, `.tmp-${name}`)
      fs.rmSync(tmp, {recursive: true, force: true})
      fs.mkdirSync(tmp, {recursive: true})
      const manifestPath = path.join(tmp, 'manifest.json')
      fs.writeFileSync(manifestPath, '{}', 'utf8')
      const html = path.join(tmp, 'index.html')
      fs.writeFileSync(
        html,
        `<html><body><script src="missing.js"></script></body></html>`
      )
      return {manifestPath, html}
    }

    it('warns (not errors) on a dead <script src> by default', () => {
      const {manifestPath, html} = writeDeadRefFixture('dead-ref-warn')
      const {compiler, compilation} = makeCompilationWithDiagnostics()
      new AddAssetsToCompilation({
        manifestPath,
        includeList: {'feature/index': html}
      } as any).apply(compiler as any)
      expect(compilation.errors).toHaveLength(0)
      expect(compilation.warnings).toHaveLength(1)
      expect(String(compilation.warnings[0].message)).toContain('NOT FOUND')
    })

    it('errors on a dead <script src> under EXTENSION_STRICT_REFS=true', () => {
      process.env.EXTENSION_STRICT_REFS = 'true'
      try {
        const {manifestPath, html} = writeDeadRefFixture('dead-ref-strict')
        const {compiler, compilation} = makeCompilationWithDiagnostics()
        new AddAssetsToCompilation({
          manifestPath,
          includeList: {'feature/index': html}
        } as any).apply(compiler as any)
        expect(compilation.warnings).toHaveLength(0)
        expect(compilation.errors).toHaveLength(1)
        expect(String(compilation.errors[0].message)).toContain('NOT FOUND')
      } finally {
        delete process.env.EXTENSION_STRICT_REFS
      }
    })
  })

  describe('root-absolute refs the build satisfies from a source sibling', () => {
    function makeCompilationWithDiagnostics(context: string) {
      const assets: Record<string, any> = {}
      const compilationObj: any = {
        options: {
          mode: 'production',
          output: {path: path.join(context, 'dist')}
        },
        getAsset: (name: string) => assets[name],
        assets,
        errors: [] as any[],
        warnings: [] as any[],
        hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
        emitAsset: (name: string, src: any) => {
          assets[name] = {
            source: {source: () => (src.source ? src.source() : src)}
          }
        }
      }
      const compiler = {
        options: {mode: 'production', context},
        hooks: {thisCompilation: {tap: (_: any, fn: any) => fn(compilationObj)}}
      }
      return {compiler, compilation: compilationObj}
    }

    function writeRootRefFixture(name: string, files: Record<string, string>) {
      const tmp = path.join(__dirname, `.tmp-${name}`)
      fs.rmSync(tmp, {recursive: true, force: true})
      fs.mkdirSync(tmp, {recursive: true})
      const manifestPath = path.join(tmp, 'manifest.json')
      fs.writeFileSync(manifestPath, '{}', 'utf8')
      const html = path.join(tmp, 'popup.html')
      fs.writeFileSync(
        html,
        `<html><body><script src="/lib/widget.js" type="module"></script></body></html>`
      )
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(tmp, rel)
        fs.mkdirSync(path.dirname(abs), {recursive: true})
        fs.writeFileSync(abs, content)
      }
      return {tmp, manifestPath, html}
    }

    function run(name: string, files: Record<string, string>) {
      const {tmp, manifestPath, html} = writeRootRefFixture(name, files)
      const {compiler, compilation} = makeCompilationWithDiagnostics(tmp)
      new AddAssetsToCompilation({
        manifestPath,
        includeList: {'action/index': html}
      } as any).apply(compiler as any)
      return compilation.warnings.map((w: any) => String(w.message))
    }

    it('does not warn when the .js ref is compiled from a .ts sibling', () => {
      expect(run('root-ref-sibling', {'lib/widget.ts': 'export {}'})).toEqual(
        []
      )
    })

    it('does not warn when the root file itself exists', () => {
      expect(
        run('root-ref-present', {'lib/widget.js': 'console.log(1)'})
      ).toEqual([])
    })

    it('warns when neither the file nor a sibling exists', () => {
      const warnings = run('root-ref-absent', {'lib/other.ts': 'export {}'})
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(
        "The page references a script file that doesn't exist."
      )
      expect(warnings[0]).toContain('/lib/widget.js')
    })

    it('does not count a sibling under public/, which copies verbatim', () => {
      const warnings = run('root-ref-public-sibling', {
        'public/lib/widget.ts': 'export {}'
      })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(
        "The page references a script file that doesn't exist."
      )
    })
  })
})
