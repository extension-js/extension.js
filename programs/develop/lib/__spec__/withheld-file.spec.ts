import {describe, expect, it} from 'vitest'
import {
  noteWithheldCssRef,
  withheldCssRefs,
  withheldFileLines
} from '../withheld-file'

describe('the two sentences a withheld file gets', () => {
  it('says a private name is never bundled', () => {
    expect(withheldFileLines('.env.js', 'private')).toEqual([
      '.env.js is not bundled.',
      'The build never bundles env files, tooling files or repository files. Move the code into a file with another name.'
    ])
  })

  it('says a file from elsewhere is not shared', () => {
    expect(withheldFileLines('../outside.png', 'outside')).toEqual([
      '../outside.png is not bundled.',
      'The file is not one the project or its workspace shares. Move it into the project.'
    ])
  })

  it('names where to look and what the file holds', () => {
    expect(
      withheldFileLines('./.env', 'private', {
        check: 'Check the icons field.',
        holds: 'contents'
      })
    ).toEqual([
      './.env is not bundled. Check the icons field.',
      'The build never bundles env files, tooling files or repository files. Move the contents into a file with another name.'
    ])
  })
})

describe('the withheld stylesheet references of a compilation', () => {
  it('lists each reference of a sheet once, by field', () => {
    const compilation = {}

    noteWithheldCssRef(compilation, './.env', 'a.css')
    noteWithheldCssRef(compilation, './.env', 'a.css')
    noteWithheldCssRef(compilation, './.env', 'b.css')

    expect(withheldCssRefs(compilation)).toEqual([
      {name: 'CssWithheldRef', ref: './.env', sheet: 'a.css'},
      {name: 'CssWithheldRef', ref: './.env', sheet: 'b.css'}
    ])
  })

  it('keeps each compilation its own list', () => {
    const first = {}

    noteWithheldCssRef(first, './.env', 'a.css')

    expect(withheldCssRefs({})).toEqual([])
    expect(withheldCssRefs(undefined)).toEqual([])
  })

  // A loader is built apart from the plugins and still writes this list.
  it('is read under a key any build of this module spells the same', () => {
    const compilation = {}

    noteWithheldCssRef(compilation, '/.env', 'a.css')

    expect(
      (compilation as Record<symbol, unknown>)[
        Symbol.for('extensionjs.withheldCssRefs')
      ]
    ).toEqual([{name: 'CssWithheldRef', ref: '/.env', sheet: 'a.css'}])
  })
})
