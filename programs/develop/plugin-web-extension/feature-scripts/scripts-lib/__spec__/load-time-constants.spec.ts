import {describe, expect, it} from 'vitest'
import {isConstantName, loadTimeConstants} from '../load-time-constants'

function missing(source: string): string[] {
  const facts = loadTimeConstants(source)
  if (facts.dynamic) return []

  return [...facts.reads].filter((name) => !facts.provided.has(name)).sort()
}

describe('isConstantName', () => {
  it('accepts a build constant spelling only', () => {
    expect(isConstantName('VERSION')).toBe(true)
    expect(isConstantName('__IS_CHROME__')).toBe(true)
    expect(isConstantName('API_V2')).toBe(true)
    expect(isConstantName('A')).toBe(false)
    expect(isConstantName('Version')).toBe(false)
    expect(isConstantName('chrome')).toBe(false)
    expect(isConstantName('JSON')).toBe(false)
    expect(isConstantName('URL')).toBe(false)
    expect(isConstantName('CSS')).toBe(false)
  })
})

describe('loadTimeConstants', () => {
  it('reports a bare read that runs as the script loads', () => {
    expect(missing('console.log(VERSION)\nconst a = `${BUILD_ID}`')).toEqual([
      'BUILD_ID',
      'VERSION'
    ])
  })

  it('follows a function the script runs on the spot', () => {
    expect(missing('(() => { console.log(VERSION) })()')).toEqual(['VERSION'])
    expect(missing('(function () { use(VERSION) }).call(this)')).toEqual([
      'VERSION'
    ])
  })

  it('leaves a read inside a function, a branch or a loop alone', () => {
    expect(missing('function f() { return VERSION }')).toEqual([])
    expect(missing('addListener(() => console.log(VERSION))')).toEqual([])
    expect(missing('if (ready) console.log(VERSION)')).toEqual([])
    expect(missing('for (const x of list) console.log(VERSION)')).toEqual([])
    expect(missing('try { console.log(VERSION) } catch {}')).toEqual([])
    expect(missing('const v = ready && VERSION')).toEqual([])
    expect(missing('const v = ready ? VERSION : 0')).toEqual([])
  })

  it('stops at a statement that may leave early', () => {
    expect(missing('if (!ready) return\nconsole.log(VERSION)')).toEqual([])
    expect(missing('if (!ready) throw 1\nconsole.log(VERSION)')).toEqual([])
    expect(missing('if (ready) use(1)\nconsole.log(VERSION)')).toEqual([
      'VERSION'
    ])
  })

  it('treats a typeof test as the author expecting the name to be missing', () => {
    expect(
      missing("const v = typeof VERSION === 'undefined' ? 'dev' : VERSION")
    ).toEqual([])
  })

  it('treats a declaration, an assignment or an import as provided', () => {
    expect(missing("var VERSION = '1'\nconsole.log(VERSION)")).toEqual([])
    expect(missing("VERSION = '1'\nconsole.log(VERSION)")).toEqual([])
    expect(
      missing("import {VERSION} from './v'\nconsole.log(VERSION)")
    ).toEqual([])

    expect(missing('const {VERSION} = pkg\nconsole.log(VERSION)')).toEqual([])
    expect(missing('function f(VERSION) {}\nconsole.log(VERSION)')).toEqual([])
    expect(missing("globalThis.VERSION ??= '1'\nconsole.log(VERSION)")).toEqual(
      []
    )
  })

  it('treats a name spelled as a property or a string as provided', () => {
    expect(missing('console.log(self.VERSION, VERSION)')).toEqual([])
    expect(missing("const k = 'VERSION'\nconsole.log(VERSION)")).toEqual([])
    expect(missing('const o = {VERSION: 1}\nconsole.log(VERSION)')).toEqual([])
  })

  it('never judges a name with a lower case letter or a platform global', () => {
    expect(missing('console.log(chrome, browser, Version, JSON, URL)')).toEqual(
      []
    )
  })

  it('says nothing about a script that can load names from outside', () => {
    expect(
      loadTimeConstants("importScripts('a.js')\nuse(VERSION)").dynamic
    ).toBe(true)

    expect(loadTimeConstants('eval(code)\nuse(VERSION)').dynamic).toBe(true)
    expect(loadTimeConstants('use(VERSION)').dynamic).toBe(false)
  })

  it('handles a script that does not parse', () => {
    expect(missing('const = VERSION')).toEqual([])
  })
})
