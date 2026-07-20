import {describe, expect, it} from 'vitest'
import {classicConcatEntry} from '../../shared/classic-concat'

const parse = (entry: string) => {
  const query = entry.slice(entry.indexOf('=') + 1)
  return JSON.parse(decodeURIComponent(query)) as {
    feature: string
    js: string[]
  }
}

describe('classicConcatEntry', () => {
  it('dedupes a file listed twice in one content_scripts group (Chrome injects it once)', () => {
    // Verified live on Chrome 150: a file listed twice in one `js` array is
    // injected EXACTLY ONCE, no error. Concatenating it twice redeclares its
    // top-level bindings and turns the whole group into a SyntaxError
    // ("Identifier 'NativeSkipper' has already been declared"), so an extension
    // Chrome runs fine failed to build, wild: ThomasTavernier/Improve-Crunchyroll
    // lists .../watch/player/skippers/skippers.js twice.
    const entry = classicConcatEntry('content_scripts/content-1', [
      '/p/shared/a.js',
      '/p/skippers.js',
      '/p/shared/b.js',
      '/p/skippers.js'
    ])

    expect(parse(entry).js).toEqual([
      '/p/shared/a.js',
      '/p/skippers.js',
      '/p/shared/b.js'
    ])
  })

  it('keeps first-occurrence order and anchors the stub on the first file', () => {
    const entry = classicConcatEntry('content_scripts/content-0', [
      '/p/one.js',
      '/p/one.js',
      '/p/two.js'
    ])

    expect(entry.startsWith('/p/one.js?')).toBe(true)
    expect(parse(entry).js).toEqual(['/p/one.js', '/p/two.js'])
  })

  it('leaves a group with no duplicates untouched', () => {
    const js = ['/p/a.js', '/p/b.js', '/p/c.js']
    expect(
      parse(classicConcatEntry('content_scripts/content-0', js)).js
    ).toEqual(js)
  })
})
