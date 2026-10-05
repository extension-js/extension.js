import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterEach, describe, expect, it} from 'vitest'
import {
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
  it('points relative and root-absolute refs at the extension root and reports each target once', () => {
    const dir = createProject()
    const {css, targets} = rewriteInlinedCssUrls(
      [
        '@font-face { src: url(./fonts/a.woff2) format("woff2"); }',
        '.a { background: url("/img/bg.png"); }',
        ".b { background: url('./fonts/a.woff2?v=2#x'); }"
      ].join('\n'),
      contextFor(dir)
    )

    expect(css).toContain(
      `url("${EXTENSION_ROOT_PLACEHOLDER}assets/content/fonts/a.woff2")`
    )

    // public/ ships at the dist root through the copier, under its own name.
    expect(css).toContain(`url("${EXTENSION_ROOT_PLACEHOLDER}img/bg.png")`)
    expect(css).toContain(
      `url("${EXTENSION_ROOT_PLACEHOLDER}assets/content/fonts/a.woff2?v=2#x")`
    )

    expect(targets.map((target) => target.outputName)).toEqual([
      'assets/content/fonts/a.woff2',
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

  it('still emits a relative reference to a file outside the public folder', () => {
    const dir = createProject()
    const {targets} = rewriteInlinedCssUrls(
      '.a { src: url(./fonts/a.woff2); }',
      {...contextFor(dir), publicDir: path.join(dir, 'public')}
    )

    expect(targets.map((target) => target.outputName)).toEqual([
      'assets/content/fonts/a.woff2'
    ])

    expect(targets[0].publicOwned).toBe(false)
  })

  it('still emits a relative reference into a public folder that does not ship', () => {
    const dir = createProject()
    const {targets} = rewriteInlinedCssUrls(
      '.a { background: url(../public/img/bg.png); }',
      contextFor(dir)
    )

    expect(targets.map((target) => target.outputName)).toEqual([
      'assets/public/img/bg.png'
    ])

    expect(targets[0].publicOwned).toBe(false)
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

  it('never names the browser or chrome namespaces as free identifiers', () => {
    const code = toRuntimeStylesheetModule(css)
    expect(code).not.toMatch(/(^|[^.\w$])browser\b/)
    expect(code).not.toMatch(/(^|[^.\w$])chrome\b/)
    expect(code).toContain('globalThis.browser')
    expect(code).toContain('globalThis.chrome')
  })
})
