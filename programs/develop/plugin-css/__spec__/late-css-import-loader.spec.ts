import {describe, expect, it} from 'vitest'
import lateCssImportLoader, {
  blankLateImports,
  findLateImports
} from '../late-css-import-loader'

function runLoader(source: string, map?: unknown) {
  const warnings: Error[] = []
  let result: {err: Error | null; content?: string; map?: unknown} | null = null
  lateCssImportLoader.call(
    {
      resourcePath: '/proj/popup/popup.css',
      rootContext: '/proj',
      callback: (err: Error | null, content?: string, m?: unknown) => {
        result = {err, content, map: m}
      },
      emitWarning: (w: Error) => warnings.push(w)
    },
    source,
    map
  )
  return {warnings, result: result!}
}

describe('late-css-import-loader: browsers skip the rule, rspack fails the module', () => {
  it('leaves leading @import, @charset and @layer statements alone', () => {
    const css = [
      '@charset "utf-8";',
      '@layer base;',
      '/* comment */',
      "@import url('a.css');",
      '@import "b.css" screen;',
      'body { margin: 0; }'
    ].join('\n')
    expect(findLateImports(css)).toEqual([])
    const {warnings, result} = runLoader(css)
    expect(warnings).toHaveLength(0)
    expect(result.content).toBe(css)
  })

  it('blanks an @import after a rule, keeps offsets, and warns with the line', () => {
    const css = [
      'body { margin: 0; }',
      '',
      "@import url('https://fonts.googleapis.com/css2?family=Inter');",
      '',
      'h1 { color: red; }'
    ].join('\n')
    const late = findLateImports(css)
    expect(late).toHaveLength(1)
    expect(late[0].line).toBe(3)

    const {warnings, result} = runLoader(css, {version: 3})
    expect(result.err).toBeNull()
    expect(result.content).toHaveLength(css.length)
    expect(result.content).not.toContain('@import')
    expect(result.content).toContain('body { margin: 0; }')
    expect(result.content).toContain('h1 { color: red; }')
    expect(result.content!.split('\n')).toHaveLength(5)
    expect(result.map).toEqual({version: 3})
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('@import')
    expect(warnings[0].message).toContain('popup/popup.css:3')
  })

  it('treats an @import nested in a block and every later one as late', () => {
    const css = [
      "@import 'first.css';",
      '@media print { @import "nested.css"; h1 { color: red; } }',
      "@import 'second.css';",
      "@import 'third.css';"
    ].join('\n')
    const late = findLateImports(css)
    expect(late.map((l) => l.line)).toEqual([2, 3, 4])
    const blanked = blankLateImports(css, late)
    expect(blanked).toContain("@import 'first.css';")
    expect(blanked).not.toContain('nested.css')
    expect(blanked).not.toContain('second.css')
    expect(blanked).toContain('h1 { color: red; }')
    expect(blanked).toHaveLength(css.length)
  })

  it('passes unparseable CSS through untouched for the parse guard', () => {
    const css = 'body { color: red; @import "x.css";'
    const {warnings, result} = runLoader(css)
    expect(warnings).toHaveLength(0)
    expect(result.content).toBe(css)
  })
})
