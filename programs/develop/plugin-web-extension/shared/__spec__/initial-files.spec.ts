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

  it('keeps a page authored under a folder named hot', () => {
    expect(isJsFile('pages/hot/deals.js')).toBe(true)
    expect(isJsFile('hot-deals/index.js')).toBe(true)
  })

  it('keeps the own chunk and every sibling of a page under hot', () => {
    const entrypoint = {
      getFiles: () => [
        'shared/framework.js',
        'shared/commons.js',
        'pages/hot/deals.js'
      ],
      getEntrypointChunk: () => ({files: new Set(['pages/hot/deals.js'])})
    }

    const files = initialJsFiles(entrypoint)

    expect(files).toEqual([
      'shared/framework.js',
      'shared/commons.js',
      'pages/hot/deals.js'
    ])
    const ownFile = entryOwnJsFile('pages/hot/deals', entrypoint, files)
    expect(ownFile).toBe('pages/hot/deals.js')
    expect(files.filter((file) => file !== ownFile)).toEqual([
      'shared/framework.js',
      'shared/commons.js'
    ])
  })

  it('still drops a hot update chunk sitting beside a page under hot', () => {
    const entrypoint = {
      getFiles: () => [
        'hot/780.ca34d5da38cd8826.js',
        'hot/780.ca34d5da38cd8826.hot-update.js',
        'shared/commons.js',
        'pages/hot/deals.js'
      ]
    }

    expect(initialJsFiles(entrypoint)).toEqual([
      'shared/commons.js',
      'pages/hot/deals.js'
    ])
  })

  it('resolves the own file of a control page and keeps its siblings', () => {
    const entrypoint = {
      getFiles: () => [
        'shared/framework.js',
        'shared/commons.js',
        'pages/deals.js'
      ],
      getEntrypointChunk: () => ({files: new Set(['pages/deals.js'])})
    }

    const files = initialJsFiles(entrypoint)
    const ownFile = entryOwnJsFile('pages/deals', entrypoint, files)

    expect(ownFile).toBe('pages/deals.js')
    expect(files.filter((file) => file !== ownFile)).toEqual([
      'shared/framework.js',
      'shared/commons.js'
    ])
  })

  it('returns nothing rather than guessing when the own file is absent', () => {
    const files = ['shared/framework.js', 'shared/commons.js']
    const entrypoint = {getFiles: () => files}

    expect(entryOwnJsFile('pages/deals', entrypoint, files)).toBeUndefined()
  })
})
