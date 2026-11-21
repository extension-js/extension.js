import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {noteWithheldCssRef} from '../../../../lib/withheld-file'
import {
  emitRootAbsoluteRefs,
  planRootAbsoluteRef
} from '../../steps/emit-root-absolute-refs'
import {writeProjectFiles} from '../../../../__spec__/helpers/extension-project'

// The bundler is not reachable from a unit fixture, so the compile step is
// observed through the requests it receives.
const compileRuntimeLoadedFiles = vi.fn(async () => [] as string[])
vi.mock(
  '../../../feature-scripts/steps/trace-runtime-loaded-files',
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

  writeProjectFiles(root, files)

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
    },
    updateAsset: (name: string, source: any) => {
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

  it('withholds a ref that escapes the root and reports one that names nothing as missing', () => {
    const {root, publicDir} = createProject({'x.js': 'var a\n'})
    expect(
      planRootAbsoluteRef('/../../etc/passwd', root, publicDir, hasNone)
    ).toEqual({kind: 'withheld', emitPath: '../../etc/passwd'})

    expect(
      planRootAbsoluteRef('/nope/missing.js', root, publicDir, hasNone)
    ).toEqual({kind: 'missing', emitPath: 'nope/missing.js'})
  })
})

describe('planRootAbsoluteRef for a path that is not project content', () => {
  const hasNone = () => false
  const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'

  it('withholds a private name and a climbing path', () => {
    const {root, publicDir} = createProject({
      '.env': MARKER,
      '.env.local': MARKER,
      '.envrc': MARKER,
      '.npmrc': MARKER,
      '.git/config': MARKER,
      '.DS_Store': MARKER,
      'cfg/.env.production': MARKER,
      'node_modules/pkg/.env': MARKER,
      'node_modules/.npmrc': MARKER,
      'a/keep.txt': 'keep'
    })

    for (const ref of [
      '/.env',
      '/.ENV',
      '/.env.local',
      '/.envrc',
      '/.npmrc',
      '/.git/config',
      '/.DS_Store',
      '/cfg/.env.production',
      '/a/../.env',
      '/%2eenv',
      '/%2Egit/config',
      '/node_modules/pkg/.env',
      '/node_modules/.npmrc',
      '/../outside.txt',
      '/a/../../outside.txt',
      '/%2e%2e/outside.txt',
      '/a/%2E%2E/%2e%2e/outside.txt'
    ]) {
      expect(planRootAbsoluteRef(ref, root, publicDir, hasNone), ref).toEqual({
        kind: 'withheld',
        emitPath: ref.slice(1)
      })
    }
  })

  it('withholds a private name that public/ holds, which the copier leaves out', () => {
    const {root, publicDir} = createProject({
      'public/.env': MARKER,
      'public/cfg/.npmrc': MARKER,
      'public/.env.example': 'KEY=\n'
    })

    expect(planRootAbsoluteRef('/.env', root, publicDir, hasNone)).toEqual({
      kind: 'withheld',
      emitPath: '.env'
    })

    expect(
      planRootAbsoluteRef('/cfg/.npmrc', root, publicDir, hasNone)
    ).toEqual({kind: 'withheld', emitPath: 'cfg/.npmrc'})

    expect(
      planRootAbsoluteRef('/.env.example', root, publicDir, hasNone)
    ).toEqual({kind: 'skip', reason: 'public', emitPath: '.env.example'})
  })

  it('plans a file of an installed package like any other the page names', () => {
    const {root, publicDir} = createProject({
      'public/node_modules/pkg/lib.js': 'var a = 1\n',
      'node_modules/pkg/other.js': 'var b = 1\n',
      'node_modules/pkg/data.json': '{}',
      'vendor/node_modules/pkg/lib.js': 'var c = 1\n'
    })

    expect(
      planRootAbsoluteRef('/node_modules/pkg/lib.js', root, publicDir, hasNone)
    ).toEqual({
      kind: 'skip',
      reason: 'public',
      emitPath: 'node_modules/pkg/lib.js'
    })

    expect(
      planRootAbsoluteRef(
        '/node_modules/pkg/other.js',
        root,
        publicDir,
        hasNone
      )
    ).toEqual({
      kind: 'copy',
      sourcePath: path.join(root, 'node_modules/pkg/other.js'),
      emitPath: 'node_modules/pkg/other.js'
    })

    expect(
      planRootAbsoluteRef(
        '/node_modules/pkg/data.json',
        root,
        publicDir,
        hasNone
      )
    ).toEqual({
      kind: 'copy',
      sourcePath: path.join(root, 'node_modules/pkg/data.json'),
      emitPath: 'node_modules/pkg/data.json'
    })

    expect(
      planRootAbsoluteRef(
        '/vendor/node_modules/pkg/lib.js',
        root,
        publicDir,
        hasNone
      )
    ).toEqual({
      kind: 'copy',
      sourcePath: path.join(root, 'vendor/node_modules/pkg/lib.js'),
      emitPath: 'vendor/node_modules/pkg/lib.js'
    })
  })

  it('leaves a path the compilation already holds to the step that emitted it', () => {
    const {root, publicDir} = createProject({'.env': MARKER})

    expect(
      planRootAbsoluteRef(
        '/assets/.env.1a2b3c4d',
        root,
        publicDir,
        (name) => name === 'assets/.env.1a2b3c4d'
      )
    ).toEqual({
      kind: 'skip',
      reason: 'emitted',
      emitPath: 'assets/.env.1a2b3c4d'
    })

    expect(
      planRootAbsoluteRef(
        '/a/../data.json',
        root,
        publicDir,
        (name) => name === 'data.json'
      )
    ).toEqual({kind: 'skip', reason: 'emitted', emitPath: 'a/../data.json'})
  })

  it.skipIf(process.platform === 'win32')(
    'follows a link that stays in the project and withholds one that leaves it or lands on a private name',
    () => {
      const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-root-abs-'))
      tempDirs.push(holder)

      const root = path.join(holder, 'project')
      const publicDir = path.join(root, 'public')
      fs.mkdirSync(path.join(root, 'data'), {recursive: true})
      fs.mkdirSync(path.join(holder, 'elsewhere'))
      fs.writeFileSync(path.join(root, 'data', 'real.txt'), 'real')
      fs.writeFileSync(path.join(root, '.env'), MARKER)
      fs.writeFileSync(path.join(holder, 'outside.txt'), MARKER)
      fs.writeFileSync(path.join(holder, 'elsewhere', 'inner.txt'), MARKER)
      fs.symlinkSync(
        path.join(root, 'data', 'real.txt'),
        path.join(root, 'alias.txt')
      )

      fs.symlinkSync(path.join(root, 'data'), path.join(root, 'alias-folder'))
      fs.symlinkSync(
        path.join(holder, 'outside.txt'),
        path.join(root, 'linked.txt')
      )

      fs.symlinkSync(
        path.join(holder, 'elsewhere'),
        path.join(root, 'linked-folder')
      )

      fs.symlinkSync(path.join(root, '.env'), path.join(root, 'settings.txt'))

      expect(
        planRootAbsoluteRef('/alias.txt', root, publicDir, hasNone)
      ).toEqual({
        kind: 'copy',
        sourcePath: path.join(root, 'alias.txt'),
        emitPath: 'alias.txt'
      })

      expect(
        planRootAbsoluteRef('/alias-folder/real.txt', root, publicDir, hasNone)
      ).toMatchObject({kind: 'copy', emitPath: 'alias-folder/real.txt'})

      for (const ref of [
        '/linked.txt',
        '/linked-folder/inner.txt',
        '/settings.txt'
      ]) {
        expect(planRootAbsoluteRef(ref, root, publicDir, hasNone), ref).toEqual(
          {kind: 'withheld', emitPath: ref.slice(1)}
        )
      }
    }
  )

  it('reads the project root, not the manifest folder, as the edge of the project', () => {
    const {root} = createProject({
      'src/manifest.json': '{}',
      'src/data/x.json': '{}',
      'shared/logo.txt': 'logo'
    })
    const manifestDir = path.join(root, 'src')
    const publicDir = path.join(root, 'public')

    expect(
      planRootAbsoluteRef('/data/x.json', manifestDir, publicDir, hasNone, root)
    ).toMatchObject({kind: 'copy', emitPath: 'data/x.json'})

    // A climbing path stays withheld even when it lands inside the project.
    expect(
      planRootAbsoluteRef(
        '/../shared/logo.txt',
        manifestDir,
        publicDir,
        hasNone,
        root
      )
    ).toEqual({kind: 'withheld', emitPath: '../shared/logo.txt'})
  })
})

// The first sentence of a finding, without color.
function firstSentence(message: string) {
  const line = message
    .split('\n')[0]
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')

  return line.slice(0, line.indexOf('.', line.indexOf(' ')) + 1)
}

describe('emitRootAbsoluteRefs for a path that is not project content', () => {
  const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'

  it('emits nothing and says each surface once that its file is not bundled', async () => {
    const {root, publicDir} = createProject({
      '.env': MARKER,
      '.env.js': MARKER,
      '.env.css': MARKER,
      '.npmrc': MARKER,
      'node_modules/pkg/.env': MARKER,
      'data/ok.json': '{}'
    })
    const {compilation, emitted} = makeCompilation({
      'page.html':
        '<link href="/.env"><img src="/.env"><img src="/node_modules/pkg/.env"><img src="/data/ok.json"><script src="/.env.js"></script><link href="/.env.css">',
      'style.css': '.a{background:url(/.npmrc)}.b{background:url(/.npmrc)}'
    })

    await emitRootAbsoluteRefs(compilation, root, publicDir)

    expect([...emitted.keys()].sort()).toEqual([
      'data/ok.json',
      'page.html',
      'style.css'
    ])

    expect(
      compilation.warnings.map((warning: Error & {file?: string}) => [
        warning.name,
        warning.file,
        firstSentence(warning.message)
      ])
    ).toEqual([
      // Under the name the page step gives a missing file of the same tag,
      // in the words of a file that is there and stays out.
      ['HtmlAssetMissing', 'page.html', '/.env is not bundled.'],
      [
        'HtmlAssetMissing',
        'page.html',
        '/node_modules/pkg/.env is not bundled.'
      ],
      ['HtmlEntrypointMissing', 'page.html', '/.env.js is not bundled.'],
      ['HtmlEntrypointMissing', 'page.html', '/.env.css is not bundled.'],
      // The file is there, so the sheet's ref is told it is not bundled.
      ['CssWithheldRef', 'style.css', '/.npmrc is not bundled.']
    ])

    expect(compilation.warnings[0].message).toContain(
      `NOT FOUND ${path.join(root, '.env')}`
    )

    expect(compilation.warnings[0].message).toContain(
      'Check the tag that names it in this page.'
    )

    expect(compilation.errors).toEqual([])
    expect(JSON.stringify(compilation.warnings.map(String))).not.toContain(
      MARKER
    )
  })

  it('stays quiet when the page step already named the ref as missing', async () => {
    const {root, publicDir} = createProject({'.env': MARKER})
    const {compilation, emitted} = makeCompilation({
      'page.html': '<img src="/.env">'
    })
    compilation.warnings.push(
      new Error('Update the /.env reference to point to a file that exists.')
    )

    await emitRootAbsoluteRefs(compilation, root, publicDir)

    expect([...emitted.keys()]).toEqual(['page.html'])
    expect(compilation.warnings).toHaveLength(1)
  })

  it('stays quiet for a stylesheet ref the stylesheet step already said is not bundled', async () => {
    const {root, publicDir} = createProject({'.env': MARKER, '.npmrc': MARKER})
    const {compilation} = makeCompilation({
      'content_scripts/content-0.css':
        '.a{background:url(/.env?v=1)}.b{background:url(/.npmrc)}'
    })
    // The step names the sheet by its source and the ref as written.
    noteWithheldCssRef(compilation, '/.env?v=1', 'injected.css')

    await emitRootAbsoluteRefs(compilation, root, publicDir)

    expect(
      compilation.warnings.map((warning: Error) => [
        warning.name,
        firstSentence(warning.message)
      ])
    ).toEqual([['CssWithheldRef', '/.npmrc is not bundled.']])
  })

  it('fails the build for a stylesheet ref when dead references are strict', async () => {
    const {root, publicDir} = createProject({'.env': MARKER})
    const {compilation, emitted} = makeCompilation({
      'style.css': '.a{background:url(/.env)}'
    })
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')

    try {
      await emitRootAbsoluteRefs(compilation, root, publicDir)
    } finally {
      vi.unstubAllEnvs()
    }

    expect([...emitted.keys()]).toEqual(['style.css'])
    expect(compilation.warnings).toEqual([])
    expect(compilation.errors.map((error: Error) => error.name)).toEqual([
      'CssWithheldRef'
    ])
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

    // The page named the source, so it now names the emitted file instead.
    expect(compilation.warnings).toHaveLength(0)
    expect(text(emitted, 'action/index.html')).toContain(
      '<script src="/scripts/util.js"></script>'
    )

    expect(text(emitted, 'action/index.html')).not.toContain('util.ts')

    for (const rel of ['styles/page.css', 'data/x.json', 'vendor/classic.js']) {
      expect(compilation.fileDependencies.has(path.join(root, rel))).toBe(true)
    }
  })

  it('points a page at the compiled file for a root-absolute jsx source', async () => {
    const {root, publicDir} = createProject({
      'src/app.jsx': 'export function App() { return null }\n'
    })
    const {compilation, emitted} = makeCompilation({
      'index.html':
        "<div id=root></div><script type='module' src='/src/app.jsx'></script>"
    })

    await emitRootAbsoluteRefs(compilation, root, publicDir)

    expect(text(emitted, 'index.html')).toContain(
      "<script type='module' src='/src/app.js'></script>"
    )

    expect(compilation.warnings).toHaveLength(0)
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

    expect(compilation.warnings).toHaveLength(0)
    expect(text(emitted, 'action/index.html')).toContain(
      '<script src="/lib/widget.js" type="module"></script>'
    )

    expect(
      compilation.fileDependencies.has(path.join(root, 'lib/widget.ts'))
    ).toBe(true)
  })
})
