import {createRequire} from 'node:module'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  carriesCompletionValue,
  closeCompletionValueBlock,
  keepCompletionValue
} from '../completion-value'

const requireModule = createRequire(import.meta.url)

const globals = () => ({
  flag: true,
  n: 0,
  window: {} as Record<string, unknown>
})

// What the browser hands executeScript for a file it runs as written.
const native = (source: string) => vm.runInNewContext(source, globals())

// The same file the way it ships: its module inside the bundle's function,
// and the emitted file closed on the value.
function bundled(source: string, file = 'scripts/hook.js', closes = true) {
  const module = `(()=>{${keepCompletionValue(source, file)}\n})();`
  const context = globals()
  const {open, closed} = closeCompletionValueBlock(module)
  const value = vm.runInNewContext(
    closes ? `${open}${closed}` : module,
    context
  )

  return {value, context}
}

const SOURCES = [
  '42',
  'window.x = 1\n42',
  '({a: 1, b: [2]})',
  '0; "kept"; var later = 2; function unused() {}',
  'var quiet = 1',
  'function f() { return 7 }\nf()',
  'null',
  'void 0',
  'window.assigned = "assigned"',
  '1\n;[2, 3].map(String)',
  'if (flag) { "yes" } else { "no" }',
  'if (!flag) "yes"; else "no"',
  '1; if (!flag) { 2 }',
  '1; if (flag) { var inner = 2 }',
  'if (flag) { 1; if (!flag) { 2 } }',
  '1; {}',
  '{ 1; { 2 } var x }',
  'try { 1 } finally { 2 }',
  'try { 1; throw new Error("x") } catch (error) {}',
  'try { throw new Error("x") } catch (error) { "caught" }',
  'for (var i = 0; i < 3; i++) { i * 2 }',
  'for (var i = 0; i < 3; i++) i * 2',
  'for (var i = 0; i < 3; i++) { if (i === 1) { "one" } }',
  'for (var i = 0; i < 3; i++) { "kept"; if (i === 1) continue }',
  'for (var i = 0; i < 2; i++) { try { 1; throw 0 } catch (error) {} }',
  '1; for (; false; ) {}',
  'while (n < 2) n++',
  'do { "x"; if (flag) break; "y" } while (false)',
  'switch (2) { case 1: "a"; break; case 2: "b"; break; default: "c" }',
  'a: { "in"; break a; "never" }',
  'outer: for (var i = 0; i < 2; i++) { for (;;) { i; continue outer } }',
  'for (var key in {a: 1, b: 2}) key',
  'for (var item of [1, 2]) { if (item === 1) item; else if (item === 3) 0 }'
]

describe('the value a scripts/ file ends on', () => {
  it.each(SOURCES)('reaches the end of its emitted file: %s', (source) => {
    const expected = native(source)
    const {value} = bundled(source)

    expect(value).toEqual(expected)
  })

  it('keeps every line where it was', () => {
    for (const source of SOURCES) {
      const rewritten = keepCompletionValue(source, 'scripts/hook.js')
      const before = source.split('\n')
      const after = rewritten.split('\n')

      expect(after).toHaveLength(before.length)
    }
  })

  it('runs unchanged in a file that is not closed on the value', () => {
    const {value, context} = bundled(
      'window.x = 1\n42',
      'scripts/hook.js',
      false
    )

    expect(value).toBeUndefined()
    expect(context.window.x).toBe(1)
    expect(Object.keys(context).sort()).toEqual(['flag', 'n', 'window'])
  })

  it('leaves no name behind on the page', () => {
    const {context} = bundled('window.x = 1\n42')

    expect(Object.keys(context).sort()).toEqual(['flag', 'n', 'window'])
  })

  it('leaves a file that ends on no value as written', () => {
    for (const source of ['var quiet = 1', 'function f() {}', '"use strict"']) {
      expect(keepCompletionValue(source, 'scripts/hook.js')).toBe(source)
    }
  })

  it('never looks inside a function or a class', () => {
    const source =
      'function f() { 1; if (flag) { 2 } }\nclass K { m() { 3 } }\nvar g = () => { 4 }'

    expect(keepCompletionValue(source, 'scripts/hook.js')).toBe(source)
  })

  it('drops the value of a scripts/ file it imports', () => {
    const source = 'import "./other.js"\nvar quiet = 1'
    const rewritten = keepCompletionValue(source, 'scripts/hook.js', {
      importsAnotherScript: true
    })

    expect(rewritten.endsWith('\n;__extjsKeep();')).toBe(true)
    expect(rewritten).toContain(source)

    const own = keepCompletionValue('import "./other.js"\n42', 'x.js', {
      importsAnotherScript: true
    })

    expect(own).not.toContain('__extjsKeep();')
    expect(own).toContain('__extjsKeep((42));')
  })

  it('reads TypeScript and JSX where it stands', () => {
    const typed =
      'const count: number = 2\nif (count > 1) {\n  "from-if" as string\n} else {\n  "from-else"\n}'
    const rewritten = keepCompletionValue(typed, 'scripts/hook.ts')
    const {code} = requireModule('@babel/core').transformSync(rewritten, {
      babelrc: false,
      configFile: false,
      filename: 'hook.ts',
      presets: [requireModule.resolve('@babel/preset-typescript')]
    })
    const {open, closed} = closeCompletionValueBlock(`(()=>{${code}\n})();`)

    expect(vm.runInNewContext(`${open}${closed}`, {})).toBe('from-if')

    expect(
      keepCompletionValue('const view = <div />\n"tsx"', 'scripts/hook.tsx')
    ).toContain('__extjsKeep(("tsx"));')

    expect(
      keepCompletionValue('const view = <div />\n"jsx"', 'scripts/hook.js')
    ).toContain('__extjsKeep(("jsx"));')
  })

  it('hands a file it cannot read back as written', () => {
    expect(keepCompletionValue('const = ;', 'scripts/hook.js')).toBe(
      'const = ;'
    )
  })

  it('closes a file once, with its source map comment still last', () => {
    const text =
      '(()=>{__extjsCompletion(1)})();\n//# sourceMappingURL=hook.js.map'
    const {open, closed} = closeCompletionValueBlock(text)
    const emitted = `${open}${closed}`

    expect(carriesCompletionValue(text)).toBe(true)
    expect(carriesCompletionValue(emitted)).toBe(false)
    expect(carriesCompletionValue('window.x = 1')).toBe(false)
    expect(emitted.endsWith('\n//# sourceMappingURL=hook.js.map')).toBe(true)
    expect(vm.runInNewContext(emitted, {})).toBe(1)
  })
})

// A stand-in for a DOM node: an object the structured clone refuses.
const pageNode = () => ({nodeType: 1, appendChild() {}})

function ended(source: string, clones = true) {
  const node = pageNode()
  const context: Record<string, unknown> = {
    node,
    ...(clones ? {structuredClone} : {})
  }
  const {open, closed} = closeCompletionValueBlock(
    `(()=>{${keepCompletionValue(source, 'scripts/hook.js')}\n})();`
  )

  return {value: vm.runInNewContext(`${open}${closed}`, context), node, context}
}

describe('a value the browser cannot clone', () => {
  it('ends the file on nothing: a DOM node, a function', () => {
    expect(ended('node').value).toBeUndefined()
    expect(ended('(function named() {})').value).toBeUndefined()
    expect(ended('window => window').value).toBeUndefined()
  })

  it('ends the file on nothing once a promise resolves to one', async () => {
    const {value} = ended('Promise.resolve(node)')

    expect(typeof value.then).toBe('function')
    expect(await value).toBeUndefined()
  })

  it('keeps a value that clones: an object, a Map, a promise of one', async () => {
    expect(ended('({a: 1, b: [2]})').value).toEqual({a: 1, b: [2]})
    expect(ended('new Map([[1, 2]])').value.get(1)).toBe(2)
    expect(await ended('Promise.resolve({a: 1})').value).toEqual({a: 1})
    expect(ended('42').value).toBe(42)
    expect(ended('null').value).toBeNull()
  })

  it('leaves a rejection as the file made it', async () => {
    await expect(
      ended('Promise.reject(new Error("refused"))').value
    ).rejects.toThrow('refused')
  })

  it('keeps the value as is where structuredClone is absent', () => {
    const {value, node} = ended('node', false)

    expect(value).toBe(node)
  })

  it('leaves no name behind on the page', () => {
    expect(Object.keys(ended('node').context).sort()).toEqual([
      'node',
      'structuredClone'
    ])
  })
})
