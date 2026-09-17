import {describe, expect, it} from 'vitest'
import {startsWorkerFromExtensionUrl} from '../steps/warn-page-context-worker'

describe('a worker started from the extension origin', () => {
  it('matches the development spelling', () => {
    expect(
      startsWorkerFromExtensionUrl(
        'const w = new Worker(new URL(/* worker import */__webpack_require__.p + __webpack_require__.u(82), __webpack_require__.b));'
      )
    ).toBe(true)
  })

  it('matches the minified spelling', () => {
    expect(
      startsWorkerFromExtensionUrl('new Worker(new URL(r.p+r.u(884),r.b))')
    ).toBe(true)
  })

  it('matches a url the bundler could not resolve to an asset', () => {
    expect(
      startsWorkerFromExtensionUrl('new Worker(new URL(r(724),r.b))')
    ).toBe(true)
  })

  it('matches a base the bundler left as import.meta.url or a runtime getURL', () => {
    expect(
      startsWorkerFromExtensionUrl('new Worker(new URL(name, import.meta.url))')
    ).toBe(true)

    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL("w.js", chrome.runtime.getURL("/")))'
      )
    ).toBe(true)

    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL("w.js", browser.runtime.getURL("/")))'
      )
    ).toBe(true)
  })

  it('matches a literal extension scheme and a call with no base at all', () => {
    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL("w.js", "chrome-extension://abc/"))'
      )
    ).toBe(true)

    expect(
      startsWorkerFromExtensionUrl(
        "new Worker(new URL('w.js', 'moz-extension://abc/'))"
      )
    ).toBe(true)

    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL("w.js", `safari-web-extension://abc/`))'
      )
    ).toBe(true)

    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL("chrome-extension://abc/w.js"))'
      )
    ).toBe(true)
  })

  it('leaves a worker resolved against the page alone', () => {
    expect(
      startsWorkerFromExtensionUrl(
        "new Worker(new URL('/w.js', location.origin))"
      )
    ).toBe(false)

    expect(
      startsWorkerFromExtensionUrl(
        "new Worker(new URL('/w.js', location.href))"
      )
    ).toBe(false)

    expect(
      startsWorkerFromExtensionUrl('new Worker(new URL(x, document.baseURI))')
    ).toBe(false)

    expect(
      startsWorkerFromExtensionUrl(
        'const w = new Worker(new URL("/w.js", window.location.origin), {type: "module"})'
      )
    ).toBe(false)
  })

  it('reads the base past a comma inside the first argument', () => {
    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL(pick("a,b", 1), location.origin))'
      )
    ).toBe(false)

    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(new URL(pick("a,b", 1), import.meta.url))'
      )
    ).toBe(true)
  })

  it('reports a file that holds both shapes', () => {
    expect(
      startsWorkerFromExtensionUrl(
        "new Worker(new URL('/w.js', location.origin));\n" +
          'new Worker(new URL(r.p+r.u(884),r.b))'
      )
    ).toBe(true)
  })

  it('leaves the blob shape alone', () => {
    expect(
      startsWorkerFromExtensionUrl(
        'new Worker(URL.createObjectURL(new Blob([source])))'
      )
    ).toBe(false)
  })

  it('leaves a worker started from a variable alone', () => {
    expect(startsWorkerFromExtensionUrl('const w = new Worker(href)')).toBe(
      false
    )
  })
})
