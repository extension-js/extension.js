import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import classicConcatLoader, {
  collectClassicGlobalNames
} from '../steps/add-content-script-wrapper/classic-concat-loader'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-concat-rw-'))
  tempDirs.push(dir)
  return dir
}

function runLoader(files: Array<{name: string; content: string}>) {
  const dir = createTempProject()
  const paths = files.map(({name, content}) => {
    const filePath = path.join(dir, name)
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  })
  const query = `?__extensionjs_classic_concat__=${encodeURIComponent(
    JSON.stringify({feature: 'content_scripts/content-0', js: paths, css: []})
  )}`
  const ctx = {
    resourcePath: paths[0],
    resourceQuery: query,
    addDependency: vi.fn(),
    callback: vi.fn()
  }
  classicConcatLoader.call(ctx as any, '')
  const [err, output, sourceMap] = ctx.callback.mock.calls[0]
  return {err, output: output as string, sourceMap, paths}
}

function bridgedNames(output: string): string[] {
  const names: string[] = []
  const re = /globalThis\["([^"]+)"\] =/g
  let match: RegExpExecArray | null
  while ((match = re.exec(output)) !== null) names.push(match[1])
  return names
}

const collect = (src: string) => collectClassicGlobalNames('f.js', src)

describe('type stripping via rspack swc (§24)', () => {
  it('erases annotations, interfaces and type aliases', () => {
    const {err, output} = runLoader([
      {
        name: 'a.ts',
        content: [
          'interface Shape { w: number }',
          'type Alias = string',
          'const size: number = 4',
          'function area(s: Shape): number { return s.w }',
          ''
        ].join('\n')
      }
    ])
    expect(err).toBeNull()
    expect(output).not.toContain('interface Shape')
    expect(output).not.toContain('type Alias')
    expect(output).not.toContain(': number')
    expect(output).toContain('const size = 4')
    expect(() => new Function(output)).not.toThrow()
  })

  it('compiles enums, class modifiers and type assertions', () => {
    const {output} = runLoader([
      {
        name: 'a.ts',
        content: [
          'enum Level { Low, High }',
          'class Box { private v: string = "x"; readonly n: number = 1 }',
          'const w = <string>(globalThis as any).label',
          ''
        ].join('\n')
      }
    ])
    expect(output).toContain('Level')
    expect(output).not.toContain('private v')
    expect(output).not.toContain('<string>')
    expect(() => new Function(output)).not.toThrow()
  })

  it('handles generics and parameter properties', () => {
    const {output} = runLoader([
      {
        name: 'a.ts',
        content: [
          'class Store<T> { constructor(private items: T[]) {} }',
          'function first<T>(xs: T[]): T | undefined { return xs[0] }',
          ''
        ].join('\n')
      }
    ])
    expect(output).not.toContain('<T>')
    expect(output).not.toContain('private items')
    expect(() => new Function(output)).not.toThrow()
  })

  it('leaves plain .js members byte-identical (no transpile pass)', () => {
    const js = 'var untouched = 1;\nfunction keep() { return untouched }\n'
    const {output} = runLoader([{name: 'a.js', content: js}])
    expect(output).toContain('var untouched = 1;')
    expect(output).toContain('function keep() { return untouched }')
  })

  it('keeps the ORIGINAL TypeScript source in sourcesContent', () => {
    const tsSource = 'const n: number = 1\n'
    const {sourceMap, paths} = runLoader([{name: 'a.ts', content: tsSource}])
    expect(sourceMap.sources).toEqual(paths)
    expect(sourceMap.sourcesContent[0]).toBe(tsSource)
    expect(sourceMap.version).toBe(3)
  })
})

describe('no "use strict" contamination (latent bug the rewrite fixes)', () => {
  it('does not inject a use-strict prologue when transpiling TS', () => {
    const {output} = runLoader([
      {name: 'a.ts', content: 'const x: number = 1\n'}
    ])
    expect(output).not.toContain('use strict')
  })

  it('a leading .ts member does not make later plain-JS members strict', () => {
    const {output} = runLoader([
      {name: 'a.ts', content: 'const typed: number = 1\n'},
      {name: 'b.js', content: 'sloppyImplicitGlobal = 5;\n'}
    ])
    expect(output).not.toContain('use strict')
    const sandbox: Record<string, unknown> = {}
    expect(() => new Function('globalThis', output)(sandbox)).not.toThrow()
  })

  it('preserves a use-strict the AUTHOR wrote in their own source', () => {
    const {output} = runLoader([
      {name: 'a.js', content: '"use strict";\nvar declared = 1;\n'}
    ])
    expect(output).toContain('"use strict"')
  })

  it('parses a .ts member as a SCRIPT, tolerating legacy HTML comments', () => {
    const {err, output} = runLoader([
      {
        name: 'legacy.ts',
        content: '<!-- legacy banner\nconst kept: number = 1\n'
      }
    ])
    expect(err).toBeNull()
    expect(output).toContain('const kept = 1')
    expect(() => new Function(output)).not.toThrow()
  })
})

describe('global-name collection via acorn (§38)', () => {
  it('collects every top-level declaration form', () => {
    const names = collect(
      'var v = 1; let l = 2; const c = 3; function fn() {} class Cls {}'
    )
    expect(names.sort()).toEqual(['Cls', 'c', 'fn', 'l', 'v'])
  })

  it('hoists var out of every block form, like the browser does', () => {
    expect(collect('if (x) { var inIf = 1 }')).toContain('inIf')
    expect(collect('for (var i = 0; i < 1; i++) {}')).toContain('i')
    expect(collect('for (var k in o) {}')).toContain('k')
    expect(collect('for (var of_ of xs) {}')).toContain('of_')
    expect(collect('while (x) { var inWhile = 1 }')).toContain('inWhile')
    expect(collect('do { var inDo = 1 } while (x)')).toContain('inDo')
    expect(
      collect('try { var inTry = 1 } catch (e) { var inCatch = 2 }')
    ).toEqual(expect.arrayContaining(['inTry', 'inCatch']))
    expect(collect('switch (x) { case 1: var inCase = 1 }')).toContain('inCase')
    expect(collect('lbl: { var inLabel = 1 }')).toContain('inLabel')
    expect(collect('{ var inBareBlock = 1 }')).toContain('inBareBlock')
  })

  it('does NOT leak nested let/const (they are lexical)', () => {
    const names = collect(
      'if (x) { let nestedLet = 1; const nestedConst = 2 } for (let j = 0; j < 1; j++) {}'
    )
    expect(names).not.toContain('nestedLet')
    expect(names).not.toContain('nestedConst')
    expect(names).not.toContain('j')
  })

  it('treats function and class bodies as opaque', () => {
    const names = collect(
      [
        'function outer() { var fnLocal = 1; let fnLet = 2; function innerFn() {} }',
        'class Holder { method() { var methodLocal = 1 } }'
      ].join('\n')
    )
    expect(names.sort()).toEqual(['Holder', 'outer'])
  })

  it('does not collect function parameters', () => {
    expect(collect('function f(paramA, paramB) {}')).toEqual(['f'])
  })

  it('does not collect a catch binding', () => {
    const names = collect('try {} catch (caughtErr) {}')
    expect(names).not.toContain('caughtErr')
  })

  it('treats an IIFE body as opaque', () => {
    const names = collect('(function () { var iifeLocal = 1 })();')
    expect(names).not.toContain('iifeLocal')
    expect(names).toEqual([])
  })

  it('treats an arrow body as opaque', () => {
    const names = collect('register(() => { var arrowLocal = 1 });')
    expect(names).not.toContain('arrowLocal')
    expect(names).toEqual([])
  })

  it('treats a class-expression body as opaque', () => {
    const names = collect('register(class { m() { var clsLocal = 1 } });')
    expect(names).not.toContain('clsLocal')
    expect(names).toEqual([])
  })

  it('treats a class static block as opaque (a var there is block-scoped)', () => {
    expect(
      collect('register(class { static { var staticLocal = 1 } });')
    ).toEqual([])
    expect(collect('class Named { static { var declLocal = 1 } }')).toEqual([
      'Named'
    ])
  })

  it('treats an object-literal method body as opaque', () => {
    const names = collect('configure({ method() { var objLocal = 1 } });')
    expect(names).not.toContain('objLocal')
    expect(names).toEqual([])
  })

  it('records the binding but not the initializer body (parity with the old impl)', () => {
    const names = collect('var holder = () => { var innerLocal = 1 };')
    expect(names).toEqual(['holder'])
  })

  describe('destructuring patterns', () => {
    it('object patterns, including renames', () => {
      expect(collect('var {a, b: renamed} = o').sort()).toEqual([
        'a',
        'renamed'
      ])
    })

    it('nested object patterns', () => {
      expect(collect('var {outerKey: {innerBinding}} = o')).toEqual([
        'innerBinding'
      ])
    })

    it('array patterns, including holes and nesting', () => {
      expect(collect('var [first, , [nested]] = arr').sort()).toEqual([
        'first',
        'nested'
      ])
    })

    it('rest elements in both pattern kinds', () => {
      expect(collect('var {kept, ...objRest} = o').sort()).toEqual([
        'kept',
        'objRest'
      ])
      expect(collect('var [head, ...arrRest] = xs').sort()).toEqual([
        'arrRest',
        'head'
      ])
    })

    it('defaults bind the left-hand name, not the default value', () => {
      expect(collect('var {withDefault = 1} = o')).toEqual(['withDefault'])
      expect(collect('var [alsoDefault = 2] = xs')).toEqual(['alsoDefault'])
    })

    it('mixed deep pattern', () => {
      expect(collect('var {a: [b, {c: d = 1}], ...e} = o').sort()).toEqual([
        'b',
        'd',
        'e'
      ])
    })
  })

  it('returns names in source order with duplicates intact', () => {
    expect(collect('var dup = 1; var dup = 2;')).toEqual(['dup', 'dup'])
  })

  it('throws on unparseable input so the caller can skip the bridge', () => {
    expect(() => collect('function (){')).toThrow()
  })
})

describe('bridging behaviour end to end', () => {
  it('de-duplicates repeated names in the emitted bridge', () => {
    const {output} = runLoader([
      {name: 'a.js', content: 'var shared = 1;\n'},
      {name: 'b.js', content: 'var shared = 2;\n'}
    ])
    const occurrences = bridgedNames(output).filter((n) => n === 'shared')
    expect(occurrences).toHaveLength(1)
  })

  it('never bridges any UMD-shadowing param or global alias', () => {
    const {output} = runLoader([
      {
        name: 'a.js',
        content: [
          'var module = 1; var exports = 2; var define = 3; var require = 4;',
          'var globalThis = 5; var window = 6; var self = 7;',
          'var legitimate = 8;'
        ].join('\n')
      }
    ])
    const bridged = bridgedNames(output)
    for (const skipped of [
      'module',
      'exports',
      'define',
      'require',
      'globalThis',
      'window',
      'self'
    ]) {
      expect(bridged).not.toContain(skipped)
    }
    expect(bridged).toContain('legitimate')
  })

  it('still concatenates when ONE member fails to parse, bridging the rest', () => {
    const {err, output} = runLoader([
      {name: 'broken.js', content: 'function (){\n'},
      {name: 'fine.js', content: 'var recovered = 1;\n'}
    ])
    expect(err).toBeNull()
    expect(output).toContain('function (){')
    expect(output).toContain('var recovered = 1;')
    expect(bridgedNames(output)).toContain('recovered')
  })

  it('bridges TypeScript declarations after type stripping', () => {
    const {output} = runLoader([
      {
        name: 'lib.ts',
        content: [
          'const config: {mode: string} = {mode: "dev"}',
          'class Service { run(): void {} }',
          'function helper(n: number): number { return n }',
          ''
        ].join('\n')
      }
    ])
    const bridged = bridgedNames(output)
    expect(bridged).toEqual(
      expect.arrayContaining(['config', 'Service', 'helper'])
    )
  })

  it('lands bridged values on the global at runtime', () => {
    const {output} = runLoader([
      {
        name: 'a.ts',
        content: [
          'const answer: number = 42',
          'function double(n: number): number { return n * 2 }',
          'if (true) { var hoistedOut = "yes" }',
          ''
        ].join('\n')
      }
    ])
    const sandbox: Record<string, any> = {}
    new Function('globalThis', output)(sandbox)
    expect(sandbox.answer).toBe(42)
    expect(sandbox.double(21)).toBe(42)
    expect(sandbox.hoistedOut).toBe('yes')
  })

  it('preserves member order across mixed .ts and .js sources', () => {
    const {output} = runLoader([
      {name: 'first.ts', content: 'const marker1: number = 1\n'},
      {name: 'second.js', content: 'var marker2 = 2;\n'},
      {name: 'third.ts', content: 'const marker3: number = 3\n'}
    ])
    expect(output.indexOf('marker1')).toBeLessThan(output.indexOf('marker2'))
    expect(output.indexOf('marker2')).toBeLessThan(output.indexOf('marker3'))
    expect(() => new Function(output)).not.toThrow()
  })
})
