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
