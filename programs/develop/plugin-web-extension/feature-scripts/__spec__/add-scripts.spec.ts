import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {AddScripts} from '../steps/add-scripts'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'

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
    // JS is sequenced into one module; CSS rides alongside as a bare entry
    // import so it extracts to the canonical content_scripts/content-N.css name
    // (routing it through the sequential module would flip it to asset/inline).
    expect(entry.import).toHaveLength(2)
    expect(entry.import[1]).toBe(cssPath)

    const sequentialSource = decodeURIComponent(
      String(entry.import[0]).replace('data:text/javascript;charset=utf-8,', '')
    )
    expect(sequentialSource).toContain(JSON.stringify(onePath))
    expect(sequentialSource).toContain(JSON.stringify(twoPath))
    // CSS is no longer imported by the sequential module itself.
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
    // classic scripts: no import/export, rely on a shared global scope
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

    // Classic multi-file entries now use the first JS file with a query
    // parameter so the classic-concat-loader can read them at build time
    // (enabling watch-mode rebuilds and source maps).
    const entryPath = String(entry.import[0])
    expect(entryPath).toContain(basePath)
    expect(entryPath).toContain('__extensionjs_classic_concat__')

    // Decode the query data and verify both files are listed in order
    const match = entryPath.match(
      /[?&]__extensionjs_classic_concat__=([^&]+)/
    )
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
    // classic sources: no top-level import/export
    fs.writeFileSync(tsPath, 'class BloomFilter { m: number = 1 }\n', 'utf8')
    fs.writeFileSync(jsPath, 'var f = new BloomFilter()\n', 'utf8')
    fs.writeFileSync(mjsPath, 'var x = 1\n', 'utf8')

    // .ts + .js group concatenates (the loader type-strips the .ts member)
    const compiler = createCompiler(projectDir)
    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {'background/scripts': [tsPath, jsPath]}
    } as any).apply(compiler as any)
    const tsEntry = String(
      (compiler.options.entry as any)['background/scripts'].import[0]
    )
    expect(tsEntry).toContain('__extensionjs_classic_concat__')

    // A .mjs member is module-scoped by definition: no concatenation
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
    // Regression: a multi-JS content-script group with CSS used to embed the CSS
    // inside the concat module. Its issuer then resolved to a content-script JS
    // file, flipping the CSS rule to asset/inline so content_scripts/content-N.css
    // was never emitted — while the manifest still declared it ("not emitted to
    // disk"). CSS must stay a bare entry import (no issuer -> extracted to file).
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
    // [ concat-stub, css ]
    expect(entry.import).toHaveLength(2)

    const entryPath = String(entry.import[0])
    expect(entryPath).toContain('__extensionjs_classic_concat__')

    // CSS must NOT be baked into the concat query...
    const match = entryPath.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
    const data = JSON.parse(decodeURIComponent(match![1]))
    expect(data.js).toEqual([basePath, childPath])
    expect(data.css).toEqual([])

    // ...it must be a bare entry import instead.
    expect(entry.import[1]).toBe(cssPath)
  })

  it('does not register a scripts/ folder entry for a file already in content_scripts (G7)', () => {
    // Regression: a file living under scripts/ AND declared in content_scripts
    // used to be registered twice — once in the content_scripts concat and once
    // as a standalone scripts/ entry. The standalone entry parsed vendored UMD
    // libs in isolation and rspack failed on their dead `require('pkg')` branch.
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
          {matches: ['<all_urls>'], js: ['scripts/thirdParty/katex.js', 'scripts/thirdParty/texmath.js']}
        ]
      }),
      'utf8'
    )

    const compiler = createCompiler(projectDir)

    new AddScripts({
      manifestPath: path.join(manifestDir, 'manifest.json'),
      includeList: {
        // content_scripts group (manifest-declared)
        'content_scripts/content-0': [umdPath, contentPath],
        // standalone scripts/ folder entries (special-folder discovered)
        'scripts/thirdParty/katex': umdPath,
        'scripts/thirdParty/texmath': contentPath,
        'scripts/helper': helperPath
      }
    } as any).apply(compiler as any)

    const entries = compiler.options.entry as any
    // The content_scripts concat entry still exists.
    expect(entries['content_scripts/content-0']).toBeTruthy()
    // The duplicated scripts/ entries for files claimed by content_scripts are gone.
    expect(entries['scripts/thirdParty/katex']).toBeUndefined()
    expect(entries['scripts/thirdParty/texmath']).toBeUndefined()
    // A genuine standalone scripts/ helper (not in the manifest) is preserved.
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
