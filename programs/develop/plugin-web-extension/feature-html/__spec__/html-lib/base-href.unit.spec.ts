import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as parse5utilities from 'parse5-utilities'
import {afterAll, describe, expect, it} from 'vitest'
import {bakeBaseHref, resolveLinkThroughBase} from '../../html-lib/base-href'
import {resolveHtmlRefPath} from '../../html-lib/utils'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-base-href-unit-'))
afterAll(() => fs.rmSync(tmp, {recursive: true, force: true}))

describe('resolveLinkThroughBase', () => {
  it('resolves relative links against a site base and a folder base', () => {
    expect(
      resolveLinkThroughBase('https://cdn.example.com/x/', 'page.html')
    ).toBe('https://cdn.example.com/x/page.html')
    expect(
      resolveLinkThroughBase('https://cdn.example.com/x/', '/top.html')
    ).toBe('https://cdn.example.com/top.html')
    expect(resolveLinkThroughBase('sub/', 'page.html')).toBe('sub/page.html')
    expect(resolveLinkThroughBase('/root/', 'page.html')).toBe(
      '/root/page.html'
    )
    expect(resolveLinkThroughBase('sub/', '/page.html')).toBe('/page.html')
  })
})

describe('bakeBaseHref', () => {
  it('moves the base into the links and drops the tag', () => {
    const doc = parse5utilities.parse(
      '<html><head><base href="https://cdn.example.com/x/"></head>' +
        '<body><a href="page.html">l</a><a href="#top">t</a>' +
        '<a href="mailto:a@b.c">m</a><a href="https://other.test/">o</a>' +
        '<form action="send"></form><img src="/assets/logo.png"></body></html>'
    )
    bakeBaseHref(doc as any)
    const html = parse5utilities.stringify(doc)
    expect(html).not.toContain('<base')
    expect(html).toContain('href="https://cdn.example.com/x/page.html"')
    expect(html).toContain('href="#top"')
    expect(html).toContain('href="mailto:a@b.c"')
    expect(html).toContain('href="https://other.test/"')
    expect(html).toContain('action="https://cdn.example.com/x/send"')
    expect(html).toContain('src="/assets/logo.png"')
  })

  it('keeps a base tag that also sets a target, without its href', () => {
    const doc = parse5utilities.parse(
      '<html><head><base href="sub/" target="_blank"></head><body></body></html>'
    )
    bakeBaseHref(doc as any)
    const html = parse5utilities.stringify(doc)
    expect(html).toContain('<base target="_blank">')
    expect(html).not.toContain('href=')
  })

  it('leaves a page with no base tag untouched', () => {
    const source =
      '<html><head></head><body><a href="page.html">l</a></body></html>'
    const doc = parse5utilities.parse(source)
    bakeBaseHref(doc as any)
    expect(parse5utilities.stringify(doc)).toBe(source)
  })
})

describe('resolveHtmlRefPath', () => {
  it('joins through a relative base first and falls back to the page folder', () => {
    fs.mkdirSync(path.join(tmp, 'sub'), {recursive: true})
    fs.writeFileSync(path.join(tmp, 'sub', 'logo.png'), 'x')
    fs.writeFileSync(path.join(tmp, 'popup.js'), 'x')
    const page = path.join(tmp, 'popup.html')
    expect(resolveHtmlRefPath(page, 'sub/', 'logo.png')).toBe(
      path.join(tmp, 'sub', 'logo.png')
    )
    expect(resolveHtmlRefPath(page, 'sub/', 'popup.js')).toBe(
      path.join(tmp, 'popup.js')
    )
    expect(resolveHtmlRefPath(page, 'sub/', 'missing.js')).toBe(
      path.join(tmp, 'sub', 'missing.js')
    )
    expect(
      resolveHtmlRefPath(page, 'https://cdn.example.com/x/', 'popup.js')
    ).toBe(path.join(tmp, 'popup.js'))
    expect(resolveHtmlRefPath(page, 'sub/', '/public/pic.png')).toBe(
      '/public/pic.png'
    )
    expect(resolveHtmlRefPath(page, undefined, 'popup.js')).toBe(
      path.join(tmp, 'popup.js')
    )
  })
})
