import {describe, expect, it} from 'vitest'
import loader, {
  annotateGetURLDynamicImports
} from '../steps/native-geturl-import-loader'

describe('native-geturl-import-loader', () => {
  it('annotates import(chrome.runtime.getURL(...)) with webpackIgnore', () => {
    const out = annotateGetURLDynamicImports(
      "import(chrome.runtime.getURL('common.js')).then((m) => m.run())\n"
    )
    expect(out).toBe(
      "import(/* webpackIgnore: true */ chrome.runtime.getURL('common.js')).then((m) => m.run())\n"
    )
  })

  it('annotates browser.runtime.getURL and computed wrappers around it', () => {
    const out = annotateGetURLDynamicImports(
      'import(browser.runtime.getURL(`js/${name}.js`)).catch(noop)\n' +
        "import(new URL(chrome.runtime.getURL('a.js')).href)\n"
    )
    expect(out.match(/webpackIgnore/g)).toHaveLength(2)
  })

  it('leaves static-specifier and bare dynamic imports alone', () => {
    const source = [
      "import x from './x.js'",
      "import('./lazy.js').then(console.log)",
      'import(someVariable)',
      'const y = import.meta.url',
      ''
    ].join('\n')
    expect(annotateGetURLDynamicImports(source)).toBe(source)
  })

  it('is idempotent and respects an existing webpackIgnore', () => {
    const once = annotateGetURLDynamicImports(
      "import(chrome.runtime.getURL('a.js'))\n"
    )
    expect(annotateGetURLDynamicImports(once)).toBe(once)
    const manual =
      "import(/* webpackIgnore: false */ chrome.runtime.getURL('a.js'))\n"
    expect(annotateGetURLDynamicImports(manual)).toBe(manual)
  })

  it('ignores matches inside strings, comments, and regex literals', () => {
    const source = [
      'const s = "import(chrome.runtime.getURL(\'x.js\'))"',
      "const t = `import(chrome.runtime.getURL('y.js'))`",
      "// import(chrome.runtime.getURL('z.js'))",
      "/* import(chrome.runtime.getURL('w.js')) */",
      'const re = /[\'"]import\\(/',
      ''
    ].join('\n')
    expect(annotateGetURLDynamicImports(source)).toBe(source)
  })

  it('annotates a real call that follows a division and a template literal', () => {
    const source = [
      'const half = total / 2',
      'const label = `count: ${items.length / 2}`',
      "import(chrome.runtime.getURL('mod.js'))",
      ''
    ].join('\n')
    const out = annotateGetURLDynamicImports(source)
    expect(out).toContain(
      "import(/* webpackIgnore: true */ chrome.runtime.getURL('mod.js'))"
    )
  })

  it('loader entry fast-paths files without getURL untouched', () => {
    const source = "import('./plain.js')\n"
    expect(loader.call(undefined, source)).toBe(source)
  })
})
