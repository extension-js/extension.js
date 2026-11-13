import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {TAKE_BLOCK_OPEN} from '../../../../lib/extension-base-from-stack'
import {
  EXTENSION_ROOT_PLACEHOLDER,
  SFC_STYLE_ATTRIBUTE
} from '../../../../plugin-css/css-lib/inline-content-script-css'
import {getContentScriptCssProbeMarker} from '../../contracts'
import {
  namesSheet,
  rootedSheet,
  runtimeScriptSheetBlock,
  runtimeScriptSheetName,
  SHEET_BLOCK_CLOSE,
  SHEET_BLOCK_OPEN,
  withoutSheetBlock
} from '../runtime-script-sheet'

interface StyleElement {
  attrs: Record<string, string>
  textContent: string
  sheet: unknown
  setAttribute(name: string, value: string): void
}

// The page a script runs in, down to what the block touches.
function page(options: {refusesInlineStyle?: boolean} = {}) {
  const placed: StyleElement[] = []
  const replaced: string[] = []

  class CSSStyleSheet {
    replaceSync(text: string) {
      replaced.push(text)
    }
  }

  const document = {
    adoptedStyleSheets: [] as unknown[],
    head: {
      appendChild(el: StyleElement) {
        placed.push(el)
        if (!options.refusesInlineStyle) el.sheet = {}
      }
    },
    documentElement: {getAttribute: () => null},
    createElement(): StyleElement {
      const attrs: Record<string, string> = {}

      return {
        attrs,
        textContent: '',
        sheet: null,
        setAttribute(name, value) {
          attrs[name] = value
        }
      }
    },
    querySelector(selector: string) {
      return (
        placed.find(
          (el) =>
            selector ===
            `style[${SFC_STYLE_ATTRIBUTE}="${el.attrs[SFC_STYLE_ATTRIBUTE]}"]`
        ) || null
      )
    }
  }

  return {placed, replaced, document, CSSStyleSheet}
}

const CSS = '.a1b2{color:red;background:url(/assets/pic.1a2b3c4d.svg)}'
const ROOT = 'chrome-extension://abcdefghijklmnop/'
const isolated = {
  chrome: {runtime: {getURL: (file: string) => ROOT + file.replace(/^\//, '')}}
}

function block(
  overrides: Partial<Parameters<typeof runtimeScriptSheetBlock>[0]>
) {
  return runtimeScriptSheetBlock({
    css: CSS,
    entryName: 'scripts/hook',
    devSalt: '',
    gecko: false,
    ...overrides
  })
}

describe('the sheet a scripts/ file carries', () => {
  it('names the sheet the build emits beside the entry', () => {
    expect(runtimeScriptSheetName('scripts/deep/hook')).toBe(
      'scripts/deep/hook.css'
    )
  })

  it('names a root url() from the extension root and leaves every other one', () => {
    expect(
      rootedSheet(
        [
          '.a{background:url(/assets/a.png)}',
          '.b{background:url("/img/b.png?v=2#x")}',
          '.c{background:url(//cdn.example/c.png)}',
          '.d{background:url(https://cdn.example/d.png)}',
          '.e{background:url(data:image/gif;base64,R0lGOD)}',
          '.f{fill:url(#gradient)}'
        ].join('')
      )
    ).toBe(
      [
        `.a{background:url("${EXTENSION_ROOT_PLACEHOLDER}assets/a.png")}`,
        `.b{background:url("${EXTENSION_ROOT_PLACEHOLDER}img/b.png?v=2#x")}`,
        '.c{background:url(//cdn.example/c.png)}',
        '.d{background:url(https://cdn.example/d.png)}',
        '.e{background:url(data:image/gif;base64,R0lGOD)}',
        '.f{fill:url(#gradient)}'
      ].join('')
    )
  })

  it('drops the source map comment a dev sheet ends on', () => {
    expect(
      rootedSheet('.a{color:red}\n\n/*# sourceMappingURL=hook.css.map*/')
    ).toBe('.a{color:red}\n')
  })

  it('is one line a script file can open on, between its two marks', () => {
    for (const gecko of [false, true]) {
      const text = block({gecko})

      expect(text.startsWith(SHEET_BLOCK_OPEN)).toBe(true)
      expect(text.endsWith(SHEET_BLOCK_CLOSE)).toBe(true)
      expect(text).not.toMatch(/[\r\n]/)
      expect(() => new vm.Script(`${text}(()=>{})();`)).not.toThrow()
    }
  })

  it('places the sheet once, its url() under the extension root', () => {
    const {placed, document, CSSStyleSheet} = page()
    const context = vm.createContext({document, CSSStyleSheet, ...isolated})

    vm.runInContext(block({}), context)
    vm.runInContext(block({}), context)

    expect(placed).toHaveLength(1)
    expect(placed[0].textContent).toBe(
      `.a1b2{color:red;background:url("${ROOT}assets/pic.1a2b3c4d.svg")}`
    )

    expect(document.adoptedStyleSheets).toHaveLength(0)
  })

  it('replaces the text of the sheet it placed when the script runs again', () => {
    const {placed, document, CSSStyleSheet} = page()
    const context = vm.createContext({document, CSSStyleSheet, ...isolated})

    vm.runInContext(block({css: '.a1b2{color:red}'}), context)
    vm.runInContext(block({css: '.a1b2{color:blue}'}), context)

    expect(placed).toHaveLength(1)
    expect(placed[0].textContent).toBe('.a1b2{color:blue}')
  })

  it('keeps one constructed sheet on a page that refuses inline style', () => {
    const {placed, replaced, document, CSSStyleSheet} = page({
      refusesInlineStyle: true
    })
    const context = vm.createContext({document, CSSStyleSheet, ...isolated})

    vm.runInContext(block({css: '.a1b2{color:red}'}), context)
    vm.runInContext(block({css: '.a1b2{color:blue}'}), context)

    expect(placed).toHaveLength(1)
    expect(document.adoptedStyleSheets).toHaveLength(1)
    expect(replaced).toEqual(['.a1b2{color:red}', '.a1b2{color:blue}'])
  })

  it('gives each entry a sheet of its own, and a dev session one per project', () => {
    const id = (text: string) =>
      /data-extjs-sfc-style=\\"([0-9a-f]+)\\"/.exec(text)?.[1]

    expect(id(block({}))).toMatch(/^[0-9a-f]{12}$/)
    expect(id(block({}))).toBe(id(block({})))
    expect(id(block({entryName: 'scripts/other'}))).not.toBe(id(block({})))
    expect(id(block({devSalt: '/projects/one'}))).not.toBe(
      id(block({devSalt: '/projects/two'}))
    )
  })

  it('runs where there is no document and leaves nothing behind', () => {
    expect(() => vm.runInNewContext(block({}), {})).not.toThrow()
  })

  it('gecko: reads the base the file took and hands it to no builtin a page can patch', () => {
    const base = 'moz-extension://11111111-2222-3333-4444-555555555555/'
    const {placed, document, CSSStyleSheet} = page()
    const context = vm.createContext({document, CSSStyleSheet})

    vm.runInContext(
      [
        'var seen = [];',
        '["split", "replace", "replaceAll", "match", "charAt", "slice", "substring", "concat"].forEach(function (name) {',
        '  var own = String.prototype[name];',
        '  String.prototype[name] = function () {',
        '    seen.push(String(this));',
        '    for (var i = 0; i < arguments.length; i++) seen.push(String(arguments[i]));',
        '    return own.apply(this, arguments);',
        '  };',
        '});',
        'var join = Array.prototype.join;',
        'Array.prototype.join = function () {',
        '  for (var i = 0; i < this.length; i++) seen.push(String(this[i]));',
        '  return join.apply(this, arguments);',
        '};'
      ].join('\n'),
      context
    )

    // The file opens on the read of the base, as the build closes it.
    vm.runInContext(
      `${TAKE_BLOCK_OPEN.replace('""', JSON.stringify(base))}${block({gecko: true})}\n}`,
      context
    )

    expect(placed).toHaveLength(1)
    expect(placed[0].textContent).toBe(
      `.a1b2{color:red;background:url("${base}assets/pic.1a2b3c4d.svg")}`
    )

    const seen = vm.runInContext('seen', context) as string[]

    expect(seen.filter((text) => text.includes('moz-extension://'))).toEqual([])
  })

  it('takes its own block back out of a file, wherever later steps moved it', () => {
    const body = '(()=>{window.ran = 1})();'

    expect(withoutSheetBlock(`${block({})}${body}`)).toBe(body)
    expect(withoutSheetBlock(`{let kept;\n${block({})}${body}\n}`)).toBe(
      `{let kept;\n${body}\n}`
    )

    expect(withoutSheetBlock(body)).toBe(body)
  })
})

describe('a script that names the sheet beside it', () => {
  it('counts a call or a fetch the author wrote', () => {
    expect(
      namesSheet(
        'insertCSS({files: ["/scripts/hook.css"]})',
        'scripts/hook.css'
      )
    ).toBe(true)

    expect(
      namesSheet('fetch(getURL("scripts/hook.css"))', 'scripts/hook.css')
    ).toBe(true)
  })

  it('does not count the marker the wrapper bakes into every bundle', () => {
    const marker = getContentScriptCssProbeMarker('scripts/hook')

    expect(marker).toContain('scripts/hook.css')
    expect(namesSheet(`var probe="${marker}";`, 'scripts/hook.css')).toBe(false)
    expect(
      namesSheet(
        `var probe="${marker}";fetch("scripts/hook.css")`,
        'scripts/hook.css'
      )
    ).toBe(true)
  })

  it('does not count another script or a script with no sheet', () => {
    expect(namesSheet('fetch("scripts/other.css")', 'scripts/hook.css')).toBe(
      false
    )

    expect(namesSheet('(()=>{})();', 'scripts/hook.css')).toBe(false)
  })
})
