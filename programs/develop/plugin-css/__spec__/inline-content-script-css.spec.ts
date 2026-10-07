import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterEach, describe, expect, it} from 'vitest'
import {
  bundledFileToken,
  EXTENSION_ROOT_PLACEHOLDER,
  rewriteInlinedCssUrls,
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
      __EXTJS_EXTENSION_BASE__: 'chrome-extension://abc'
    })
    expect(decodeURIComponent(String(exported))).toContain(
      'url("chrome-extension://abc/assets/img/bg.png")'
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
        {__EXTJS_EXTENSION_BASE__: 'moz-extension://uuid'}
      )

      expect(text).toContain(
        'url("moz-extension://uuid/assets/a.1234abcd.woff2")'
      )

      expect(text).toContain(
        'url("moz-extension://uuid/assets/b.5678ef01.png?v=2#x")'
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

  it('never names the browser or chrome namespaces as free identifiers', () => {
    const code = toRuntimeStylesheetModule(css)
    expect(code).not.toMatch(/(^|[^.\w$])browser\b/)
    expect(code).not.toMatch(/(^|[^.\w$])chrome\b/)
    expect(code).toContain('globalThis.browser')
    expect(code).toContain('globalThis.chrome')
  })
})
