import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {omitOwnedPages} from '../omit-owned-pages'

const root = path.join(path.sep, 'project')
const about = path.join(root, 'pages', 'about', 'about.html')
const help = path.join(root, 'pages', 'help', 'help.html')

describe('omitOwnedPages', () => {
  it('drops a pages/ entry whose file the manifest already names', () => {
    const pages = {'pages/about/about': about, 'pages/help/help': help}
    const owned = {'action/index': about}

    expect(omitOwnedPages(pages, owned)).toEqual({'pages/help/help': help})
  })

  it('compares resolved paths, so a differently spelled path still matches', () => {
    const pages = {
      'pages/about/about': path.join(root, 'pages', '.', 'about', 'about.html')
    }

    expect(omitOwnedPages(pages, {'action/index': about})).toEqual({})
  })

  it('keeps every entry when nothing is owned', () => {
    const pages = {'pages/help/help': help}

    expect(omitOwnedPages(pages, {})).toEqual(pages)
  })

  it('keeps an entry with no files and tolerates a missing list', () => {
    expect(omitOwnedPages({empty: undefined}, {'action/index': about})).toEqual(
      {empty: undefined}
    )

    expect(omitOwnedPages(undefined, {'action/index': about})).toEqual({})
  })
})
