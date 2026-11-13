import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterEach, describe, expect, it} from 'vitest'
import {
  bundledFileToken,
  EXTENSION_ROOT_PLACEHOLDER,
  rewriteInlinedCssUrls,
  SFC_STYLE_ATTRIBUTE,
  toRuntimeStylesheetModule
} from '../css-lib/inline-content-script-css'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-inline-cs-css-'))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'content', 'fonts'), {recursive: true})
  fs.mkdirSync(path.join(dir, 'public', 'img'), {recursive: true})
  fs.writeFileSync(path.join(dir, 'content', 'fonts', 'a.woff2'), 'font')
  fs.writeFileSync(path.join(dir, 'public', 'img', 'bg.png'), 'image')

  return dir
}

function contextFor(dir: string) {
  return {
    resourcePath: path.join(dir, 'content', 'styles.css'),
    manifestDir: dir,
    publicRoot: path.join(dir, 'public')
  }
}

function evaluateModule(code: string, globals: Record<string, unknown>) {
  const module = {exports: ''}
  vm.runInNewContext(code, {module, ...globals})

  return module.exports
}

describe('rewriteInlinedCssUrls', () => {
  it('names a public file from the extension root, leaves any other file to the bundler, and reports each target once', () => {
    const dir = createProject()
    const {css, targets} = rewriteInlinedCssUrls(
      [
        '@font-face { src: url(./fonts/a.woff2) format("woff2"); }',
        '.a { background: url("/img/bg.png"); }',
        ".b { background: url('./fonts/a.woff2?v=2#x'); }"
      ].join('\n'),
      contextFor(dir)
    )

    expect(css).toContain(`url("${bundledFileToken(0)}")`)

    // public/ ships at the dist root through the copier, under its own name.
    expect(css).toContain(`url("${EXTENSION_ROOT_PLACEHOLDER}img/bg.png")`)
    expect(css).toContain(`url("${bundledFileToken(0)}?v=2#x")`)
    expect(css).not.toContain('assets/')

    expect(targets.map((target) => target.outputName)).toEqual([
      undefined,
      'img/bg.png'
    ])

    expect(targets.map((target) => target.publicOwned)).toEqual([false, true])
    expect(targets[0].absolutePath).toBe(
      path.join(dir, 'content', 'fonts', 'a.woff2')
    )
  })

  it('leaves remote, data:, fragment, protocol-relative, absolute and missing refs as authored', () => {
    const dir = createProject()
    const source = [
      '.a { background: url("https://cdn.example/x.png"); }',
      '.b { background: url(data:image/gif;base64,R0lGOD); }',
      '.c { fill: url(#gradient); }',
      '.d { background: url(//cdn.example/x.png); }',
      '.e { background: url("chrome-extension://abc/x.png"); }',
      '.f { background: url("./missing.png"); }',
      '.g { background: url("/missing.png"); }'
    ].join('\n')

    const {css, targets} = rewriteInlinedCssUrls(source, contextFor(dir))

    expect(css).toBe(source)
    expect(targets).toEqual([])
  })
})

describe('rewriteInlinedCssUrls names a public-owned file by its copied path', () => {
  for (const spelling of [
    '/img/bg.png',
    '../public/img/bg.png',
    './../public/img/bg.png'
  ]) {
    it(`resolves url('${spelling}') to the one copy the public folder ships`, () => {
      const dir = createProject()
      const {css, targets} = rewriteInlinedCssUrls(
        `.a { background: url('${spelling}'); }`,
        {...contextFor(dir), publicDir: path.join(dir, 'public')}
      )

      expect(css).toBe(
        `.a { background: url("${EXTENSION_ROOT_PLACEHOLDER}img/bg.png"); }`
      )

      expect(targets).toHaveLength(1)
      expect(targets[0].outputName).toBe('img/bg.png')
      expect(targets[0].publicOwned).toBe(true)
    })
  }

  it('leaves a relative reference to a file outside the public folder to the bundler', () => {
    const dir = createProject()
    const {css, targets} = rewriteInlinedCssUrls(
      '.a { src: url(./fonts/a.woff2); }',
      {...contextFor(dir), publicDir: path.join(dir, 'public')}
    )

    expect(css).toBe(`.a { src: url("${bundledFileToken(0)}"); }`)
    expect(targets).toEqual([
      {
        request: './fonts/a.woff2',
        absolutePath: path.join(dir, 'content', 'fonts', 'a.woff2'),
        publicOwned: false
      }
    ])
  })

  it('leaves a relative reference into a public folder that does not ship to the bundler', () => {
    const dir = createProject()
    const {css, targets} = rewriteInlinedCssUrls(
      '.a { background: url(../public/img/bg.png); }',
      contextFor(dir)
    )

    expect(css).toBe(`.a { background: url("${bundledFileToken(0)}"); }`)
    expect(targets.map((target) => target.publicOwned)).toEqual([false])
  })

  it('gives each bundled file its own token, in the order the sheet names them', () => {
    const dir = createProject()
    fs.writeFileSync(path.join(dir, 'content', 'fonts', 'b.woff2'), 'font')

    const {css, targets} = rewriteInlinedCssUrls(
      [
        '.a { src: url(./fonts/a.woff2); }',
        '.b { background: url(/img/bg.png); }',
        '.c { src: url(./fonts/b.woff2); }',
        '.d { src: url(./fonts/a.woff2); }'
      ].join('\n'),
      contextFor(dir)
    )

    expect(css.match(/__EXTENSIONJS_CSS_FILE_\d+__/g)).toEqual([
      bundledFileToken(0),
      bundledFileToken(1),
      bundledFileToken(0)
    ])

    expect(targets.map((target) => target.request)).toEqual([
      './fonts/a.woff2',
      '/img/bg.png',
      './fonts/b.woff2'
    ])
  })
})

describe('toRuntimeStylesheetModule', () => {
  const css = `.a { background: url("${EXTENSION_ROOT_PLACEHOLDER}assets/img/bg.png"); }`

  it('exports a data: URL whose text names the extension root from chrome.runtime', () => {
    const exported = evaluateModule(toRuntimeStylesheetModule(css), {
      chrome: {runtime: {getURL: () => 'chrome-extension://abc/'}}
    })

    expect(String(exported).startsWith('data:text/css;charset=utf-8,')).toBe(
      true
    )

    const text = decodeURIComponent(
      String(exported).split(',').slice(1).join(',')
    )
    expect(text).toBe(
      '.a { background: url("chrome-extension://abc/assets/img/bg.png"); }'
    )
  })

  it('prefers the browser namespace where it exists', () => {
    const exported = evaluateModule(toRuntimeStylesheetModule(css), {
      browser: {runtime: {getURL: () => 'moz-extension://uuid/'}},
      chrome: {runtime: {getURL: () => 'chrome-extension://abc/'}}
    })
    expect(decodeURIComponent(String(exported))).toContain(
      'moz-extension://uuid/assets/img/bg.png'
    )
  })

  it('falls back to a root-absolute path when no runtime API is reachable', () => {
    const exported = evaluateModule(toRuntimeStylesheetModule(css), {})
    expect(decodeURIComponent(String(exported))).toContain(
      'url("/assets/img/bg.png")'
    )
  })

  it('reads the bridge base in a MAIN world script, which has no runtime API', () => {
    const exported = evaluateModule(toRuntimeStylesheetModule(css), {
      document: {
        documentElement: {getAttribute: () => 'chrome-extension://abc'}
      }
    })
    expect(decodeURIComponent(String(exported))).toContain(
      'url("chrome-extension://abc/assets/img/bg.png")'
    )
  })

  it('takes no base from a global the page can set', () => {
    const module = toRuntimeStylesheetModule(css)
    const exported = evaluateModule(module, {
      __EXTJS_EXTENSION_BASE__: 'https://evil.example/'
    })

    expect(module).not.toContain('__EXTJS_EXTENSION_BASE__')
    expect(decodeURIComponent(String(exported))).not.toContain('evil.example')
    expect(decodeURIComponent(String(exported))).toContain(
      'url("/assets/img/bg.png")'
    )
  })

  it('reads the base a shipped MAIN world bundle kept, once <html> no longer carries it', () => {
    const keptBase = Object.assign(() => {}, {
      extjsBase: 'chrome-extension://abc/'
    })
    const exported = evaluateModule(toRuntimeStylesheetModule(css), {
      __webpack_require__: keptBase,
      document: {documentElement: {getAttribute: () => null}}
    })

    expect(decodeURIComponent(String(exported))).toContain(
      'url("chrome-extension://abc/assets/img/bg.png")'
    )
  })

  describe('with files the bundler names', () => {
    const bundledCss = [
      `.a { background: url("${bundledFileToken(0)}"); }`,
      `.b { background: url("${bundledFileToken(1)}?v=2#x"); }`,
      `.c { background: url("${bundledFileToken(0)}#y"); }`,
      `.d { background: url("${EXTENSION_ROOT_PLACEHOLDER}img/bg.png"); }`
    ].join('\n')

    function evaluateBundled(
      answers: Record<string, string>,
      globals: Record<string, unknown>
    ) {
      const code = toRuntimeStylesheetModule(bundledCss, [
        './fonts/a.woff2',
        '../local/b.png'
      ])
      const requests = Array.from(
        code.matchAll(/new URL\(("[^"]*"), import\.meta\.url\)/g),
        (match) => JSON.parse(match[1])
      )
      const exported = evaluateModule(
        code.replace(
          /new URL\(("[^"]*"), import\.meta\.url\)/g,
          '__bundled($1)'
        ),
        {
          __bundled: (request: string) => {
            if (!(request in answers)) throw new TypeError('Invalid URL')

            return new URL(answers[request], 'https://page.example/dir/')
          },
          ...globals
        }
      )

      return {
        requests,
        text: decodeURIComponent(String(exported).split(',').slice(1).join(','))
      }
    }

    it('asks the bundler for each file and names it from the extension root', () => {
      const {requests, text} = evaluateBundled(
        {
          './fonts/a.woff2': 'chrome-extension://abc/assets/a.1234abcd.woff2',
          '../local/b.png': 'chrome-extension://abc/assets/b.5678ef01.png'
        },
        {chrome: {runtime: {getURL: () => 'chrome-extension://abc/'}}}
      )

      expect(requests).toEqual(['./fonts/a.woff2', '../local/b.png'])
      expect(text).toBe(
        [
          '.a { background: url("chrome-extension://abc/assets/a.1234abcd.woff2"); }',
          '.b { background: url("chrome-extension://abc/assets/b.5678ef01.png?v=2#x"); }',
          '.c { background: url("chrome-extension://abc/assets/a.1234abcd.woff2#y"); }',
          '.d { background: url("chrome-extension://abc/img/bg.png"); }'
        ].join('\n')
      )
    })

    it('keeps only the path of an answer that resolved against the visited page', () => {
      const {text} = evaluateBundled(
        {
          './fonts/a.woff2': '/assets/a.1234abcd.woff2',
          '../local/b.png': '/assets/b.5678ef01.png'
        },
        {
          document: {
            documentElement: {getAttribute: () => 'chrome-extension://uuid'}
          }
        }
      )

      expect(text).toContain(
        'url("chrome-extension://uuid/assets/a.1234abcd.woff2")'
      )

      expect(text).toContain(
        'url("chrome-extension://uuid/assets/b.5678ef01.png?v=2#x")'
      )

      expect(text).not.toContain('page.example')
    })

    it('carries a file the bundler inlined as the data: URL it answered with', () => {
      const {text} = evaluateBundled(
        {
          './fonts/a.woff2': 'data:font/woff2;base64,AAAA',
          '../local/b.png': 'data:image/png;base64,BBBB'
        },
        {chrome: {runtime: {getURL: () => 'chrome-extension://abc/'}}}
      )

      expect(text).toContain(
        '.a { background: url("data:font/woff2;base64,AAAA"); }'
      )

      expect(text).toContain(
        '.b { background: url("data:image/png;base64,BBBB"); }'
      )

      expect(text).toContain(
        '.c { background: url("data:font/woff2;base64,AAAA"); }'
      )
    })

    it('leaves the rest of the sheet standing when one file has no answer', () => {
      const {text} = evaluateBundled(
        {'../local/b.png': 'chrome-extension://abc/assets/b.5678ef01.png'},
        {chrome: {runtime: {getURL: () => 'chrome-extension://abc/'}}}
      )

      expect(text).toContain(
        'url("chrome-extension://abc/assets/b.5678ef01.png?v=2#x")'
      )

      expect(text).toContain('url("chrome-extension://abc/img/bg.png")')
      expect(text).toContain('.a { background: url("about:invalid"); }')
      expect(text).not.toContain('__EXTENSIONJS_CSS_FILE_')
    })

    it('writes a file request into the module as ASCII only', () => {
      const request = './fonts/a"b</script>\u2028c\u2029d\u00e9.woff2'
      const code = toRuntimeStylesheetModule(bundledCss, [request])

      expect(code).toMatch(/^[\x00-\x7f]*$/)
      expect(code).not.toContain('</script>')

      const literal = code.match(
        /new URL\(("(?:[^"\\]|\\.)*"), import\.meta\.url\)/
      )?.[1]
      expect(JSON.parse(String(literal))).toBe(request)
    })
  })

  describe('in a Gecko build, whose MAIN world file took the base as it opened', () => {
    const gecko = toRuntimeStylesheetModule(css, [], undefined, true)
    const rooted = 'url("moz-extension://abc/assets/img/bg.png")'
    // The module inside the block its file opens on.
    const taken = (base: string) =>
      `{let __extjsTakenBase=${JSON.stringify(base)};${gecko}\n}`

    it('names the extension root from the copy the file took', () => {
      for (const base of ['moz-extension://abc/', 'moz-extension://abc']) {
        const exported = evaluateModule(taken(base), {
          __EXTJS_EXTENSION_BASE__: 'moz-extension://page-set/',
          document: {
            documentElement: {getAttribute: () => 'moz-extension://on-html/'}
          }
        })

        expect(decodeURIComponent(String(exported))).toContain(rooted)
      }
    })

    it('finds the copy on the require function in a chunk that took nothing', () => {
      const exported = evaluateModule(gecko, {
        __webpack_require__: Object.assign(() => {}, {
          extjsBase: 'moz-extension://abc/'
        }),
        document: {
          documentElement: {getAttribute: () => 'moz-extension://on-html/'}
        }
      })

      expect(decodeURIComponent(String(exported))).toContain(rooted)
    })

    it('falls back to <html> where the file took nothing', () => {
      const exported = evaluateModule(taken(''), {
        document: {
          documentElement: {getAttribute: () => 'moz-extension://abc/'}
        }
      })

      expect(decodeURIComponent(String(exported))).toContain(rooted)
    })

    it('closes the base on its slash by index, not through replace', () => {
      expect(gecko).toContain(
        'return (base[base.length - 1] === "/" ? base : base + "/");'
      )

      expect(gecko).not.toContain('base.replace(')
    })

    it('puts the sheet together through no method a page script can patch', () => {
      const sheet =
        `.a{background:url("${EXTENSION_ROOT_PLACEHOLDER}img/a.png")}` +
        `.b{background:url("${bundledFileToken(0)}?v=1")}` +
        `.c{background:url("${EXTENSION_ROOT_PLACEHOLDER}img/c.png")}`
      const code = toRuntimeStylesheetModule(
        sheet,
        ['./fonts/a.woff2'],
        'style-1',
        true
      )
      const seen: string[] = []
      const module = {exports: ''}
      const context = vm.createContext({
        module,
        seen,
        URL: class {
          protocol = 'moz-extension:'
          pathname = '/assets/a.woff2'
        }
      })

      vm.runInContext(
        `(function () {
          var starts = String.prototype.indexOf
          var wrap = function (owner, name) {
            var original = owner[name]
            owner[name] = function () {
              var all = [this].concat(Array.prototype.slice.call(arguments))
              for (var i = 0; i < all.length; i++) {
                if (typeof all[i] === "string" && starts.call(all[i], "moz-extension:") !== -1) seen.push(name)
              }
              return original.apply(this, arguments)
            }
          }
          wrap(String.prototype, "replace")
          wrap(String.prototype, "split")
          wrap(String.prototype, "charAt")
          wrap(Array.prototype, "join")
        })()`,
        context
      )

      vm.runInContext(
        `{let __extjsTakenBase="moz-extension://abc/";${code.replace('import.meta.url', '"moz-extension://abc/"')}\n}`,
        context
      )

      expect(module.exports).toBe(
        '.a{background:url("moz-extension://abc/img/a.png")}' +
          '.b{background:url("moz-extension://abc/assets/a.woff2?v=1")}' +
          '.c{background:url("moz-extension://abc/img/c.png")}'
      )

      expect(seen).toEqual([])
      expect(code).not.toContain('.join(')
      expect(code).not.toContain('__extjsCssText.split(')
    })

    it('never asks for the base in a sheet that names no extension file', () => {
      const code = toRuntimeStylesheetModule(
        '.a{color:red}',
        [],
        'style-2',
        true
      )

      expect(code).toContain('var __extjsSfcCss = ".a{color:red}";')
      expect(code.split('__extjsExtensionRoot()')).toHaveLength(2)
    })

    it('leaves the module of every other browser as it was', () => {
      expect(toRuntimeStylesheetModule(css, [], 'style-3')).toBe(
        toRuntimeStylesheetModule(css, [], 'style-3', false)
      )

      expect(toRuntimeStylesheetModule(css, [], 'style-3')).toContain(
        '__extjsCssText.split('
      )

      const plain = toRuntimeStylesheetModule(css)

      expect(toRuntimeStylesheetModule(css, [], undefined, false)).toBe(plain)
      expect(plain).not.toContain('__extjsTakenBase')
      expect(plain).toContain(
        'if (base) return base.replace(/\\/+$/, "") + "/";'
      )
    })
  })

  it('never names the browser or chrome namespaces as free identifiers', () => {
    // The scheme a base is checked against is text, never an identifier.
    const code = toRuntimeStylesheetModule(css)
      .split('"chrome-extension:/')
      .join('"')
    expect(code).not.toMatch(/(^|[^.\w$])browser\b/)
    expect(code).not.toMatch(/(^|[^.\w$])chrome\b/)
    expect(code).toContain('globalThis.browser')
    expect(code).toContain('globalThis.chrome')
  })
})

describe('toRuntimeStylesheetModule with a style id', () => {
  function fakeDocument() {
    const elements: Array<{
      attributes: Record<string, string>
      textContent: string
      setAttribute(name: string, value: string): void
    }> = []
    const head = {
      appendChild(element: (typeof elements)[number]) {
        elements.push(element)
      }
    }

    return {
      elements,
      document: {
        head,
        documentElement: head,
        createElement: () => ({
          attributes: {} as Record<string, string>,
          textContent: '',
          setAttribute(name: string, value: string) {
            this.attributes[name] = value
          }
        }),
        querySelector: (selector: string) =>
          elements.find(
            (element) =>
              selector ===
              `style[${SFC_STYLE_ATTRIBUTE}="${element.attributes[SFC_STYLE_ATTRIBUTE]}"]`
          ) || null
      }
    }
  }

  const css = `.a { background: url("${EXTENSION_ROOT_PLACEHOLDER}img/bg.png"); }`
  const chrome = {runtime: {getURL: () => 'chrome-extension://abc/'}}

  it('adds one <style> element holding the sheet and exports its text', () => {
    const {document, elements} = fakeDocument()
    const exported = evaluateModule(
      toRuntimeStylesheetModule(css, [], 'block-a'),
      {document, chrome}
    )

    const text = '.a { background: url("chrome-extension://abc/img/bg.png"); }'
    expect(exported).toBe(text)
    expect(elements).toHaveLength(1)
    expect(elements[0].attributes[SFC_STYLE_ATTRIBUTE]).toBe('block-a')
    expect(elements[0].textContent).toBe(text)
  })

  it('rewrites the element it added before, and keeps another block apart', () => {
    const {document, elements} = fakeDocument()
    const run = (sheet: string, id: string) =>
      evaluateModule(toRuntimeStylesheetModule(sheet, [], id), {document})

    run('.a { color: red; }', 'block-a')
    run('.b { color: blue; }', 'block-b')
    run('.a { color: green; }', 'block-a')

    expect(elements.map((element) => element.textContent)).toEqual([
      '.a { color: green; }',
      '.b { color: blue; }'
    ])
  })

  it('still evaluates where there is no document', () => {
    expect(
      evaluateModule(toRuntimeStylesheetModule('.a{}', [], 'block-a'), {})
    ).toBe('.a{}')
  })
})

describe('toRuntimeStylesheetModule on a page that refuses inline style', () => {
  class FakeSheet {
    text = ''

    replaceSync(text: string) {
      this.text = text
    }
  }

  // A style-src without 'unsafe-inline' leaves the element with no sheet.
  function fakeDocument(refuses: boolean) {
    const elements: Array<Record<string, unknown>> = []
    const head = {
      appendChild(element: Record<string, unknown>) {
        elements.push(element)
      }
    }

    return {
      elements,
      document: {
        head,
        documentElement: head,
        adoptedStyleSheets: [] as FakeSheet[],
        createElement: () => ({
          attributes: {} as Record<string, string>,
          textContent: '',
          sheet: refuses ? null : {},
          setAttribute(name: string, value: string) {
            this.attributes[name] = value
          }
        }),
        querySelector: () => elements[0] || null
      }
    }
  }

  const run = (document: unknown, sheet: string) =>
    evaluateModule(toRuntimeStylesheetModule(sheet, [], 'block-a'), {
      document,
      CSSStyleSheet: FakeSheet
    })

  it('adopts a constructed sheet in place of the refused element', () => {
    const {document} = fakeDocument(true)

    run(document, '.a { color: red; }')

    expect(document.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([
      '.a { color: red; }'
    ])
  })

  it('replaces the rules of the sheet it adopted before and adds no second one', () => {
    const {document, elements} = fakeDocument(true)

    run(document, '.a { color: red; }')
    run(document, '.a { color: green; }')

    expect(elements).toHaveLength(1)
    expect(document.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([
      '.a { color: green; }'
    ])
  })

  it('adopts nothing where the element was accepted', () => {
    const {document, elements} = fakeDocument(false)

    run(document, '.a { color: red; }')

    expect(elements[0].textContent).toBe('.a { color: red; }')
    expect(document.adoptedStyleSheets).toEqual([])
  })
})
