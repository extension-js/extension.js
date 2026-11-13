import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {toRuntimeStylesheetModule} from '../css-lib/inline-content-script-css'

const HEADING = '### Content script styles on a page with a strict style policy'

// The section alone, with one line ending whatever the checkout wrote.
function note(): string {
  const readme = fs
    .readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
    .split('\r\n')
    .join('\n')
  const from = readme.indexOf(HEADING)

  expect(from).toBeGreaterThan(-1)

  const next = readme.indexOf('\n### ', from + HEADING.length)

  return readme.slice(from, next === -1 ? readme.length : next)
}

function exportedBy(css: string, gecko: boolean): string {
  const module = {exports: ''}

  vm.runInNewContext(toRuntimeStylesheetModule(css, [], undefined, gecko), {
    module
  })

  return String(module.exports)
}

describe('the note on content script styles under a strict style policy', () => {
  const css = '.panel { color: rgb(1, 2, 3); content: "a,b"; }'

  it.each([
    ['Chromium', false],
    ['Firefox', true]
  ])('rests on the data: URL a %s content script gets for a sheet', (_engine, gecko) => {
    expect(
      exportedBy(css, gecko).startsWith('data:text/css;charset=utf-8,')
    ).toBe(true)

    expect(note()).toContain('both answer a `data:text/css` URL')
  })

  it.each([
    ['Chromium', false],
    ['Firefox', true]
  ])('gives a recipe that reads the sheet back out of that URL on %s', (_engine, gecko) => {
    const recipe = "decodeURIComponent(href.slice(href.indexOf(',') + 1))"

    expect(note()).toContain(`sheet.replaceSync(${recipe})`)

    const read = vm.runInNewContext(recipe, {href: exportedBy(css, gecko)})

    expect(read).toBe(css)
  })

  it('names what each world was measured to do with the sheet', () => {
    const rows = note()
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
      )
    const row = (call: string) =>
      rows.find((cells) => cells[0].includes(call))?.slice(1)

    expect(row('fetch(href)')).toEqual(['answers', 'answers'])
    expect(row('`<style>` element')).toEqual([
      'applies',
      'refused, `style-src-elem` inline'
    ])

    expect(row('href={href}')).toEqual([
      'applies',
      'refused, `style-src-elem` `data:`'
    ])

    expect(row('web accessible extension file')).toEqual(['applies', 'applies'])
    expect(row('adoptedStyleSheets')).toEqual(['applies', 'applies'])
  })

  it('says the build changes no call and prints no warning', () => {
    expect(note()).toContain('it changes none of them and prints no warning')
  })
})
