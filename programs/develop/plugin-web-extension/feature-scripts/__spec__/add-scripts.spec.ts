import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
import {AddScripts} from '../steps/add-scripts'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-add-scripts-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"fixture"}\n',
    'utf8'
  )
  return dir
}

function createCompiler(context: string) {
  return {
    options: {
      context,
      entry: {}
    },
    hooks: {
      thisCompilation: {
        tap() {}
      }
    },
    rspack: {
      WebpackError: Error
    }
  }
}

describe('AddScripts', () => {
  it('uses a sequential entry module for multi-file content script groups', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    fs.mkdirSync(path.join(manifestDir, 'content'), {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/one.ts', 'content/two.ts']
          }
        ]
      }),
      'utf8'
    )

    const onePath = path.join(manifestDir, 'content', 'one.ts')
    const twoPath = path.join(manifestDir, 'content', 'two.ts')
    const cssPath = path.join(manifestDir, 'content', 'styles.css')
    fs.writeFileSync(onePath, 'export default 1\n', 'utf8')
    fs.writeFileSync(twoPath, 'export default 2\n', 'utf8')
    fs.writeFileSync(cssPath, '.content { color: red; }\n', 'utf8')

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'content_scripts/content-0': [onePath, twoPath, cssPath]
      }
    } as any).apply(compiler as any)

    const entry = (compiler.options.entry as any)['content_scripts/content-0']
    expect(entry.layer).toBe(EXTENSIONJS_CONTENT_SCRIPT_LAYER)
    expect(entry.import).toHaveLength(2)
    expect(entry.import[1]).toBe(cssPath)

    const sequentialSource = decodeURIComponent(
      String(entry.import[0]).replace('data:text/javascript;charset=utf-8,', '')
    )
    expect(sequentialSource).toContain(JSON.stringify(onePath))
    expect(sequentialSource).toContain(JSON.stringify(twoPath))
    expect(sequentialSource).not.toContain(JSON.stringify(cssPath))
    expect(sequentialSource.indexOf(JSON.stringify(onePath))).toBeLessThan(
      sequentialSource.indexOf(JSON.stringify(twoPath))
    )
  })

  it('emits a concat-loader entry for classic multi-file content scripts', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    fs.mkdirSync(path.join(manifestDir, 'content'), {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/base.js', 'content/child.js']
          }
        ]
      }),
      'utf8'
    )

    const basePath = path.join(manifestDir, 'content', 'base.js')
    const childPath = path.join(manifestDir, 'content', 'child.js')
    fs.writeFileSync(basePath, 'class BaseSite {}\n', 'utf8')
    fs.writeFileSync(childPath, 'class Child extends BaseSite {}\n', 'utf8')

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'content_scripts/content-0': [basePath, childPath]
      }
    } as any).apply(compiler as any)

    const entry = (compiler.options.entry as any)['content_scripts/content-0']
    expect(entry.import).toHaveLength(1)

    const entryPath = String(entry.import[0])
    expect(entryPath).toContain(basePath)
    expect(entryPath).toContain('__extensionjs_classic_concat__')

    const match = entryPath.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
    expect(match).toBeTruthy()
    const data = JSON.parse(decodeURIComponent(match![1]))
    expect(data.js).toEqual([basePath, childPath])
    expect(data.feature).toBe('content_scripts/content-0')
  })

  it('concatenates classic .ts members (§24) but never .mjs ones', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )
    const tsPath = path.join(manifestDir, 'bloomfilter.ts')
    const jsPath = path.join(manifestDir, 'background.js')
    const mjsPath = path.join(manifestDir, 'module-scoped.mjs')
    fs.writeFileSync(tsPath, 'class BloomFilter { m: number = 1 }\n', 'utf8')
    fs.writeFileSync(jsPath, 'var f = new BloomFilter()\n', 'utf8')
    fs.writeFileSync(mjsPath, 'var x = 1\n', 'utf8')

    const compiler = createCompiler(projectDir)
    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {'background/scripts': [tsPath, jsPath]}
    } as any).apply(compiler as any)
    const tsEntry = String(
      (compiler.options.entry as any)['background/scripts'].import[0]
    )
    expect(tsEntry).toContain('__extensionjs_classic_concat__')

    const compiler2 = createCompiler(projectDir)
    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {'background/scripts': [jsPath, mjsPath]}
    } as any).apply(compiler2 as any)
    const mjsEntry = String(
      (compiler2.options.entry as any)['background/scripts'].import[0]
    )
    expect(mjsEntry).not.toContain('__extensionjs_classic_concat__')
  })

  it('keeps CSS as a bare entry import for classic multi-file content scripts (G10)', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    fs.mkdirSync(path.join(manifestDir, 'content'), {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content/base.js', 'content/child.js'],
            css: ['content/styles.css']
          }
        ]
      }),
      'utf8'
    )

    const basePath = path.join(manifestDir, 'content', 'base.js')
    const childPath = path.join(manifestDir, 'content', 'child.js')
    const cssPath = path.join(manifestDir, 'content', 'styles.css')
    fs.writeFileSync(basePath, 'class BaseSite {}\n', 'utf8')
    fs.writeFileSync(childPath, 'class Child extends BaseSite {}\n', 'utf8')
    fs.writeFileSync(cssPath, '.content { color: red; }\n', 'utf8')

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'content_scripts/content-0': [basePath, childPath, cssPath]
      }
    } as any).apply(compiler as any)

    const entry = (compiler.options.entry as any)['content_scripts/content-0']
    expect(entry.import).toHaveLength(2)

    const entryPath = String(entry.import[0])
    expect(entryPath).toContain('__extensionjs_classic_concat__')

    const match = entryPath.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
    const data = JSON.parse(decodeURIComponent(match![1]))
    expect(data.js).toEqual([basePath, childPath])
    expect(data.css).toEqual([])

    expect(entry.import[1]).toBe(cssPath)
  })

  it('does not register a scripts/ folder entry for a file already in content_scripts (G7)', () => {
    const projectDir = createTempProject()
    const manifestDir = projectDir
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(path.join(scriptsDir, 'thirdParty'), {recursive: true})

    const umdPath = path.join(scriptsDir, 'thirdParty', 'katex.js')
    const contentPath = path.join(scriptsDir, 'thirdParty', 'texmath.js')
    const helperPath = path.join(scriptsDir, 'helper.js')
    fs.writeFileSync(umdPath, 'var k = 1;\n', 'utf8')
    fs.writeFileSync(contentPath, 'var t = 2;\n', 'utf8')
    fs.writeFileSync(helperPath, 'export const h = 1\n', 'utf8')

    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['scripts/thirdParty/katex.js', 'scripts/thirdParty/texmath.js']
          }
        ]
      }),
      'utf8'
    )

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'content_scripts/content-0': [umdPath, contentPath],
        'scripts/thirdParty/katex': umdPath,
        'scripts/thirdParty/texmath': contentPath,
        'scripts/helper': helperPath
      }
    } as any).apply(compiler as any)

    const entries = compiler.options.entry as any
    expect(entries['content_scripts/content-0']).toBeTruthy()
    expect(entries['scripts/thirdParty/katex']).toBeUndefined()
    expect(entries['scripts/thirdParty/texmath']).toBeUndefined()
    expect(entries['scripts/helper']).toEqual({
      import: [helperPath],
      layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })
  })

  it('assigns the content-script layer to scripts folder entries without rewriting them', () => {
    const projectDir = createTempProject()
    const manifestDir = path.join(projectDir, 'src')
    const scriptsDir = path.join(projectDir, 'scripts')
    fs.mkdirSync(manifestDir, {recursive: true})
    fs.mkdirSync(scriptsDir, {recursive: true})
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    const scriptPath = path.join(scriptsDir, 'standalone.ts')
    fs.writeFileSync(scriptPath, 'export default function run() {}\n', 'utf8')

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        'scripts/standalone': scriptPath
      }
    } as any).apply(compiler as any)

    expect((compiler.options.entry as any)['scripts/standalone']).toEqual({
      import: [scriptPath],
      layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })
  })
})
