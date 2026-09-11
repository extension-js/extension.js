import {describe, expect, it} from 'vitest'
import {entryOwnJsFile, initialJsFiles, isJsFile} from '../initial-files'

describe('initial JS files for a page entry', () => {
  it('keeps ordinary chunks', () => {
    expect(isJsFile('shared/framework.js')).toBe(true)
    expect(isJsFile('chrome_url_overrides/newtab.js')).toBe(true)
  })

  it('drops hot update chunks, named with or without the infix', () => {
    expect(isJsFile('hot/780.ca34d5da38cd8826.hot-update.js')).toBe(false)
    expect(isJsFile('hot/780.ca34d5da38cd8826.js')).toBe(false)
  })

  it('leaves a hot update chunk out of the files a page loads', () => {
    const entrypoint = {
      getFiles: () => [
        'hot/780.ca34d5da38cd8826.js',
        'shared/framework.js',
        'chrome_url_overrides/newtab.js'
      ]
    }

    const files = initialJsFiles(entrypoint)

    expect(files).toEqual([
      'shared/framework.js',
      'chrome_url_overrides/newtab.js'
    ])
    expect(
      entryOwnJsFile('chrome_url_overrides/newtab', entrypoint, files)
    ).toBe('chrome_url_overrides/newtab.js')
  })
})
