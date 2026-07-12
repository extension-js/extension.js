import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import classicConcatLoader from '../steps/setup-reload-strategy/add-content-script-wrapper/classic-concat-loader'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-concat-'))
  tempDirs.push(dir)
  return dir
}

function createLoaderContext(
  resourcePath: string,
  queryData: {feature: string; js: string[]; css?: string[]}
) {
  const query = `?__extensionjs_classic_concat__=${encodeURIComponent(
    JSON.stringify(queryData)
  )}`
  return {
    resourcePath,
    resourceQuery: query,
    addDependency: vi.fn(),
    callback: vi.fn()
  }
}

describe('classic-concat-loader', () => {
  it('concatenates multiple JS files and emits a source map', () => {
    const dir = createTempProject()
    const basePath = path.join(dir, 'base.js')
    const childPath = path.join(dir, 'child.js')
    fs.writeFileSync(basePath, 'class Base {}\n', 'utf8')
    fs.writeFileSync(childPath, 'class Child extends Base {}\n', 'utf8')

    const ctx = createLoaderContext(basePath, {
      feature: 'content_scripts/content-0',
      js: [basePath, childPath],
      css: []
    })

    classicConcatLoader.call(ctx as any, '')

    expect(ctx.callback).toHaveBeenCalledTimes(1)
    const [err, output, sourceMap] = ctx.callback.mock.calls[0]
    expect(err).toBeNull()
    expect(output).toContain('class Base {}')
    expect(output).toContain('class Child extends Base {}')
    expect(output.indexOf('class Base')).toBeLessThan(
      output.indexOf('class Child')
    )

    // Source map should reference original files
    expect(sourceMap).toBeTruthy()
    expect(sourceMap.version).toBe(3)
    expect(sourceMap.sources).toEqual([basePath, childPath])
    expect(sourceMap.sourcesContent).toEqual([
      'class Base {}\n',
      'class Child extends Base {}\n'
    ])
    expect(sourceMap.mappings).toBeTruthy()
  })

  it('registers each JS file as a dependency for watch mode', () => {
    const dir = createTempProject()
    const aPath = path.join(dir, 'a.js')
    const bPath = path.join(dir, 'b.js')
    fs.writeFileSync(aPath, 'var a = 1;\n', 'utf8')
    fs.writeFileSync(bPath, 'var b = 2;\n', 'utf8')

    const ctx = createLoaderContext(aPath, {
      feature: 'content_scripts/content-0',
      js: [aPath, bPath],
      css: []
    })

    classicConcatLoader.call(ctx as any, '')

    expect(ctx.addDependency).toHaveBeenCalledWith(aPath)
    expect(ctx.addDependency).toHaveBeenCalledWith(bPath)
  })

  it('includes CSS import statements at the top', () => {
    const dir = createTempProject()
    const jsPath = path.join(dir, 'main.js')
    const cssPath = path.join(dir, 'styles.css')
    fs.writeFileSync(jsPath, 'console.log("hi");\n', 'utf8')

    const ctx = createLoaderContext(jsPath, {
      feature: 'content_scripts/content-0',
      js: [jsPath],
      css: [cssPath]
    })

    classicConcatLoader.call(ctx as any, '')

    const [, output] = ctx.callback.mock.calls[0]
    expect(output).toContain(`import ${JSON.stringify(cssPath)};`)
    expect(output.indexOf('import')).toBeLessThan(output.indexOf('console.log'))
  })

  it('wraps the concat so UMD require/define are shadowed, not rewritten (G7)', () => {
    const dir = createTempProject()
    const umdPath = path.join(dir, 'texmath.js')
    const browserifyPath = path.join(dir, 'jszip.js')
    // Mirrors the katex-style UMD dead branch that broke the build, plus a
    // browserify-style INTERNAL require that must survive verbatim.
    fs.writeFileSync(
      umdPath,
      [
        'if (typeof module === "object") texmath.katex = require("katex");',
        'else texmath.katex = {};'
      ].join('\n') + '\n',
      'utf8'
    )
    fs.writeFileSync(
      browserifyPath,
      '(function(f){})({1:[function(require,module,exports){var u=require("./utils")}]})\n',
      'utf8'
    )

    const ctx = createLoaderContext(umdPath, {
      feature: 'content_scripts/content-0',
      js: [umdPath, browserifyPath],
      css: []
    })

    classicConcatLoader.call(ctx as any, '')

    const [, output] = ctx.callback.mock.calls[0]
    // The source is wrapped in a function whose params shadow the module system,
    // called with all four undefined — rspack then treats every `require` as a
    // locally-bound variable and does not statically collect it.
    expect(output).toContain(
      ';(function (module, exports, define, require) {'
    )
    expect(output).toContain(
      '}).call(typeof globalThis !== "undefined" ? globalThis : this, void 0, void 0, void 0, void 0);'
    )
    // Require/define calls are NOT rewritten — that would break browserify libs
    // whose inner `function (require, module, exports)` provides its own require.
    expect(output).toContain('require("katex")')
    expect(output).toContain('function(require,module,exports){var u=require("./utils")}')
    // The wrapper must enclose the user sources.
    expect(output.indexOf('(function (module')).toBeLessThan(
      output.indexOf('require("katex")')
    )
    expect(output.indexOf('require("katex")')).toBeLessThan(
      output.indexOf('}).call(typeof globalThis')
    )
  })

  it('passes source through unchanged when no concat query is present', () => {
    const ctx = {
      resourcePath: '/some/file.js',
      resourceQuery: '',
      addDependency: vi.fn(),
      callback: vi.fn()
    }

    classicConcatLoader.call(ctx as any, 'original source')

    expect(ctx.callback).toHaveBeenCalledWith(null, 'original source')
    expect(ctx.addDependency).not.toHaveBeenCalled()
  })
})

describe('classic-concat-loader TypeScript members (§24)', () => {
  it('type-strips .ts files before concatenation so the group stays parseable', () => {
    const dir = createTempProject()
    const tsPath = path.join(dir, 'bloomfilter.ts')
    const jsPath = path.join(dir, 'background.js')
    fs.writeFileSync(
      tsPath,
      'class BloomFilter {\n  m: number;\n  constructor(m: number) { this.m = m }\n}\n',
      'utf8'
    )
    fs.writeFileSync(jsPath, 'var f = new BloomFilter(8)\n', 'utf8')

    const ctx = createLoaderContext(tsPath, {
      feature: 'background/scripts',
      js: [tsPath, jsPath],
      css: []
    })

    classicConcatLoader.call(ctx as any, '')

    const [err, output, sourceMap] = ctx.callback.mock.calls[0]
    expect(err).toBeNull()
    // Type annotations are gone, the class and its consumer share the scope.
    expect(output).not.toContain('m: number')
    expect(output).toContain('class BloomFilter')
    expect(output).toContain('new BloomFilter(8)')
    // Source map still references the ORIGINAL TS source.
    expect(sourceMap.sources).toContain(tsPath)
    expect(sourceMap.sourcesContent[0]).toContain('m: number')
    // The concatenated output must be valid JavaScript.
    expect(() => new Function(output)).not.toThrow()
  })
})
