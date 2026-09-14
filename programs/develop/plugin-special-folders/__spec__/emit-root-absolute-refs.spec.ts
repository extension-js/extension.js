import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  emitRootAbsoluteRefs,
  planRootAbsoluteRef
} from '../emit-root-absolute-refs'

// The bundler is not reachable from a unit fixture, so the compile step is
// observed through the requests it receives.
const compileRuntimeLoadedFiles = vi.fn(async () => [] as string[])
vi.mock(
  '../../plugin-web-extension/feature-scripts/steps/trace-runtime-loaded-files',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    compileRuntimeLoadedFiles: (...args: unknown[]) =>
      compileRuntimeLoadedFiles(...(args as []))
  })
)

const tempDirs: string[] = []

afterEach(() => {
  compileRuntimeLoadedFiles.mockClear()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function createProject(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-root-abs-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content, 'utf8')
  }
  return {root, publicDir: path.join(root, 'public')}
}

function makeCompilation(assets: Record<string, string>) {
  const emitted = new Map(
    Object.entries(assets).map(([name, src]) => [
      name,
      {name, source: {source: () => src}}
    ])
  )
  const compilation: any = {
    warnings: [],
    errors: [],
    fileDependencies: new Set<string>(),
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    }
  }
  return {compilation, emitted}
}

const text = (emitted: Map<string, any>, name: string) =>
  emitted.get(name)?.source.source().toString()

describe('planRootAbsoluteRef', () => {
  const hasNone = () => false

  it('copies data files and classic hand-written .js verbatim', () => {
    const {root, publicDir} = createProject({
      'data/x.json': '{"a":1}',
      'vendor/classic.js': 'var READY = true\nfunction hello() {}\n'
    })
    expect(
      planRootAbsoluteRef('/data/x.json', root, publicDir, hasNone)
    ).toEqual({
      kind: 'copy',
      sourcePath: path.join(root, 'data/x.json'),
      emitPath: 'data/x.json'
    })
    expect(
      planRootAbsoluteRef('/vendor/classic.js', root, publicDir, hasNone)
    ).toMatchObject({kind: 'copy', emitPath: 'vendor/classic.js'})
  })

  it('compiles an ES module .js as a module, the shape the tag loads it in', () => {
    const {root, publicDir} = createProject({
      'lib/mod.js': 'import x from "pkg"\nexport const y = x\n'
    })
    expect(
      planRootAbsoluteRef('/lib/mod.js', root, publicDir, hasNone)
    ).toEqual({
      kind: 'compile',
      sourcePath: path.join(root, 'lib/mod.js'),
      emitPath: 'lib/mod.js',
      format: 'module'
    })
  })

  it('compiles a TypeScript ref to its .js spelling and reports the spelling', () => {
    const {root, publicDir} = createProject({
      'lib/widget.ts': 'export const n: number = 1\n'
    })
    expect(
      planRootAbsoluteRef('/lib/widget.ts', root, publicDir, hasNone)
    ).toEqual({
      kind: 'compile',
      sourcePath: path.join(root, 'lib/widget.ts'),
      emitPath: 'lib/widget.js',
      format: 'module',
      spelledAs: 'lib/widget.ts'
    })
  })

  it('compiles the source sibling of a .js ref that only exists as a source', () => {
    const {root, publicDir} = createProject({
      'lib/widget.ts': 'export const n: number = 1\n'
    })
    expect(
      planRootAbsoluteRef('/lib/widget.js', root, publicDir, hasNone)
    ).toEqual({
      kind: 'compile',
      sourcePath: path.join(root, 'lib/widget.ts'),
      emitPath: 'lib/widget.js',
      format: 'module'
    })
  })

  it('skips what public/ owns, what is already emitted, and a source the main pipeline compiled', () => {
    const {root, publicDir} = createProject({
      'public/img/logo.svg': '<svg/>',
      'img/logo.svg': '<svg>root</svg>',
      'scripts/util.ts': 'export {}\n',
      'lib/done.js': 'var a = 1\n'
    })
    expect(
      planRootAbsoluteRef('/img/logo.svg', root, publicDir, hasNone)
    ).toEqual({kind: 'skip', reason: 'public', emitPath: 'img/logo.svg'})
    expect(
      planRootAbsoluteRef(
        '/lib/done.js',
        root,
        publicDir,
        (name) => name === 'lib/done.js'
      )
    ).toEqual({kind: 'skip', reason: 'emitted', emitPath: 'lib/done.js'})
    // The scripts/ entry already produced scripts/util.js, the .ts spelling
    // must ship nothing and point the author at the emitted path.
    expect(
      planRootAbsoluteRef(
        '/scripts/util.ts',
        root,
        publicDir,
        (name) => name === 'scripts/util.js'
      )
    ).toEqual({
      kind: 'skip',
      reason: 'compiled-elsewhere',
      emitPath: 'scripts/util.js',
      spelledAs: 'scripts/util.ts'
    })
  })

  it('returns null for values that are not root-absolute refs', () => {
    const {root, publicDir} = createProject({'x.js': 'var a\n'})
    expect(planRootAbsoluteRef('./x.js', root, publicDir, hasNone)).toBeNull()
    expect(
      planRootAbsoluteRef('//cdn.example.com/x.js', root, publicDir, hasNone)
    ).toBeNull()
    expect(
      planRootAbsoluteRef(path.join(root, 'x.js'), root, publicDir, hasNone)
    ).toBeNull()
    expect(planRootAbsoluteRef('/', root, publicDir, hasNone)).toBeNull()
  })

  it('reports a ref that escapes the root or names nothing as missing', () => {
    const {root, publicDir} = createProject({'x.js': 'var a\n'})
    expect(
      planRootAbsoluteRef('/../../etc/passwd', root, publicDir, hasNone)
    ).toMatchObject({kind: 'missing'})
    expect(
      planRootAbsoluteRef('/nope/missing.js', root, publicDir, hasNone)
    ).toEqual({kind: 'missing', emitPath: 'nope/missing.js'})
  })
})

describe('emitRootAbsoluteRefs', () => {
  it('copies data, css and classic scripts through the fixed point and never ships a source spelling', async () => {
    const {root, publicDir} = createProject({
      'styles/page.css': 'body { background: url(/data/x.json); }\n',
      'data/x.json': '{\n  "answer": 42\n}\n',
      'vendor/classic.js': 'var VENDOR = 1\nfunction vendorHello() {}\n',
      'scripts/util.ts': 'const label: string = "u"\nexport {}\n'
    })
    const {compilation, emitted} = makeCompilation({
      'action/index.html':
        '<link rel="stylesheet" href="/styles/page.css">' +
        '<script src="/scripts/util.ts"></script>' +
        '<script src="/vendor/classic.js"></script>',
      'scripts/util.js': 'console.log("compiled by the main pipeline")'
    })

    await emitRootAbsoluteRefs(compilation, root, publicDir)

    expect(text(emitted, 'styles/page.css')).toBe(
      'body { background: url(/data/x.json); }\n'
    )
    // Found in the copied stylesheet, so it needs the second pass.
    expect(text(emitted, 'data/x.json')).toBe('{\n  "answer": 42\n}\n')
    expect(text(emitted, 'vendor/classic.js')).toBe(
      'var VENDOR = 1\nfunction vendorHello() {}\n'
    )
    expect(emitted.has('scripts/util.ts')).toBe(false)
    expect(text(emitted, 'scripts/util.js')).toBe(
      'console.log("compiled by the main pipeline")'
    )
    expect(compileRuntimeLoadedFiles).not.toHaveBeenCalled()

    expect(compilation.warnings).toHaveLength(1)
    const [warning] = compilation.warnings
    expect(warning.name).toBe('RootAbsoluteRefCompiledSource')
    expect(warning.file).toBe('action/index.html')
    expect(String(warning.message)).toContain(
      "action/index.html loads '/scripts/util.ts' via an HTML src/href attribute, but /scripts/util.ts is compiled to scripts/util.js"
    )

    for (const rel of ['styles/page.css', 'data/x.json', 'vendor/classic.js']) {
      expect(compilation.fileDependencies.has(path.join(root, rel))).toBe(true)
    }
  })

  it('hands JS-like refs to the bundler once per output path instead of walking their imports', async () => {
    const {root, publicDir} = createProject({
      'lib/widget.ts':
        'import {WORD} from "./word"\nexport const MESSAGE: string = WORD\n',
      'lib/word.ts': 'export const WORD: string = "w"\n',
      'lib/mod.js': 'import "/lib/dep.js"\nexport const y = 1\n',
      'lib/dep.js': 'export const dep = 1\n'
    })
    const {compilation, emitted} = makeCompilation({
      // The same file under its source and emitted spelling, from two assets.
      'action/index.html':
        '<script src="/lib/widget.ts" type="module"></script>' +
        '<script src="/lib/mod.js" type="module"></script>',
      'styles/page.css': 'a { cursor: url(/lib/widget.js); }'
    })

    await emitRootAbsoluteRefs(compilation, root, publicDir)

    expect(compileRuntimeLoadedFiles).toHaveBeenCalledTimes(1)
    const [, , requests] = compileRuntimeLoadedFiles.mock
      .calls[0] as unknown as [unknown, unknown, Array<Record<string, unknown>>]
    expect(requests).toEqual([
      {
        sourcePath: path.join(root, 'lib/widget.ts'),
        emitPath: 'lib/widget.js',
        format: 'module',
        context: 'html'
      },
      {
        sourcePath: path.join(root, 'lib/mod.js'),
        emitPath: 'lib/mod.js',
        format: 'module',
        context: 'html'
      }
    ])
    // The bundler resolves imports, so nothing is copied for them here.
    expect(emitted.has('lib/word.ts')).toBe(false)
    expect(emitted.has('lib/word.js')).toBe(false)
    expect(emitted.has('lib/dep.js')).toBe(false)
    expect(emitted.has('lib/widget.ts')).toBe(false)

    expect(compilation.warnings).toHaveLength(1)
    expect(String(compilation.warnings[0].message)).toContain(
      "loads '/lib/widget.ts' via an HTML src/href attribute"
    )
    expect(
      compilation.fileDependencies.has(path.join(root, 'lib/widget.ts'))
    ).toBe(true)
  })
})
