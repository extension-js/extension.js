import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {
  buildPages,
  PAGE_FILES,
  writePageProject
} from '../../../plugin-reload/__spec__/helpers/page-builds'
import {readHtml} from '../html-lib/read-html'

const tempFolder = trackTempFolders()
const TIMEOUT = 180_000

const page = (charset: string, body: string) =>
  `<!doctype html><html><head><meta charset="${charset}"><title>t</title></head><body>${body}<script src="./popup.js"></script></body></html>`

function write(bytes: Buffer): string {
  const file = path.join(
    fs.realpathSync(tempFolder('extjs-read-html-')),
    'p.html'
  )

  fs.writeFileSync(file, bytes)

  return file
}

describe('reading a page that is not UTF-8', () => {
  it('reads a UTF-8 page as written, byte order mark included', () => {
    const text = `﻿${page('utf-8', 'café 日本')}`

    expect(readHtml(write(Buffer.from(text, 'utf8')))).toEqual({
      text,
      outcome: 'utf-8'
    })
  })

  it('decodes a page from the charset its meta tag declares', () => {
    const read = readHtml(
      write(Buffer.from(page('windows-1252', 'café déjà'), 'latin1'))
    )

    expect(read).toEqual({
      text: page('utf-8', 'café déjà'),
      outcome: 'converted',
      declared: 'windows-1252'
    })
  })

  it('reads the http-equiv form of the tag', () => {
    const html =
      '<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><p>café</p>'
    const read = readHtml(write(Buffer.from(html, 'latin1')))

    expect(read.outcome).toBe('converted')
    expect(read.text).toBe(
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><p>café</p>'
    )
  })

  it('decodes a multibyte charset', () => {
    // "日本語" in Shift_JIS.
    const body = Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea])
    const [head, tail] = page('shift_jis', '\u0000').split('\u0000')
    const read = readHtml(
      write(Buffer.concat([Buffer.from(head), body, Buffer.from(tail)]))
    )

    expect(read.text).toBe(page('utf-8', '日本語'))
  })

  it('decodes a UTF-16 page by its byte order mark', () => {
    const text = page('utf-16', 'café 日本')
    const read = readHtml(
      write(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
      )
    )

    expect(read).toEqual({
      text: page('utf-8', 'café 日本'),
      outcome: 'converted',
      declared: 'utf-16le'
    })
  })

  it('says a page is undecodable when it declares nothing', () => {
    const read = readHtml(write(Buffer.from('<p>caf\xe9</p>', 'latin1')))

    expect(read).toEqual({
      text: '<p>caf�</p>',
      outcome: 'undecodable',
      declared: undefined
    })
  })

  it('says so too for a charset it does not know and for a false UTF-8 claim', () => {
    for (const charset of ['x-made-up', 'utf-8']) {
      const read = readHtml(
        write(Buffer.from(page(charset, 'caf\xe9'), 'latin1'))
      )

      expect(read.outcome, charset).toBe('undecodable')
      expect(read.declared, charset).toBe(charset)
    }
  })
})

describe('a build with a page that is not UTF-8', () => {
  async function build(popup: Buffer) {
    const root = fs.realpathSync(tempFolder('extjs-non-utf8-page-'))

    writePageProject(root, {...PAGE_FILES, 'popup.html': popup})

    const built = await buildPages(root, 'production build')

    return {built, root}
  }

  it(
    'ships the text of a declared charset as UTF-8 and warns once',
    async () => {
      const {built} = await build(
        Buffer.from(page('windows-1252', 'café déjà'), 'latin1')
      )
      const html = built.html['action/index.html']

      expect(built.errors).toEqual([])
      expect(html).toContain('café déjà')
      expect(html).toContain('<meta charset="utf-8">')
      expect(html).not.toContain('�')
      expect(html).not.toContain('windows-1252')

      expect(built.warnings).toEqual([
        {
          name: 'HtmlPageNotUtf8',
          code: 'W_HTML_NOT_UTF8',
          file: 'popup.html',
          message: expect.stringMatching(
            /popup\.html is encoded as windows-1252[\s\S]*Save the file as UTF-8/
          )
        }
      ])
    },
    TIMEOUT
  )

  it(
    'warns that a page with no known charset shows replacement characters',
    async () => {
      const {built} = await build(
        Buffer.from(
          '<!doctype html><html><head></head><body>caf\xe9<script src="./popup.js"></script></body></html>',
          'latin1'
        )
      )

      expect(built.html['action/index.html']).toContain('caf�')
      expect(built.warnings).toEqual([
        {
          name: 'HtmlPageNotUtf8',
          code: 'W_HTML_NOT_UTF8',
          file: 'popup.html',
          message: expect.stringMatching(
            /popup\.html is not UTF-8 and declares no charset[\s\S]*replacement character[\s\S]*Save the file as UTF-8/
          )
        }
      ])
    },
    TIMEOUT
  )

  it(
    'says nothing for a UTF-8 page',
    async () => {
      const {built} = await build(
        Buffer.from(page('utf-8', 'café 日本'), 'utf8')
      )

      expect(built.html['action/index.html']).toContain('café 日本')
      expect(built.warnings).toEqual([])
    },
    TIMEOUT
  )
})
