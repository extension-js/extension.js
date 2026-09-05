import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
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

// Runs the generated module the way a content script would, with whichever
// runtime globals the caller provides.
function evaluateModule(code: string, globals: Record<string, unknown>) {
  const module = {exports: ''}
  const names = Object.keys(globals)
  const run = new Function('module', ...names, code)
  run(module, ...names.map((name) => globals[name]))
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
    expect(css).toContain(
      `url("${EXTENSION_ROOT_PLACEHOLDER}assets/public/img/bg.png")`
    )
    expect(css).toContain(
      `url("${EXTENSION_ROOT_PLACEHOLDER}assets/content/fonts/a.woff2?v=2#x")`
    )
    expect(targets.map((target) => target.outputName)).toEqual([
      'assets/content/fonts/a.woff2',
      'assets/public/img/bg.png'
    ])
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
})
