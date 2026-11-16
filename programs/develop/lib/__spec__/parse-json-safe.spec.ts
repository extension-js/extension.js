import {describe, expect, it} from 'vitest'
import {
  blankJsonComments,
  hasJsonComments,
  parseAuthoredJson,
  parseJsonSafe,
  stripBom
} from '../parse-json-safe'

describe('stripBom', () => {
  it('removes a leading UTF-8 BOM', () => {
    expect(stripBom('\uFEFF{"a":1}')).toBe('{"a":1}')
  })

  it('leaves BOM-less input untouched', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}')
  })

  it('only strips the first BOM (not interior characters)', () => {
    expect(stripBom('\uFEFF{"a":"\uFEFF"}')).toBe('{"a":"\uFEFF"}')
  })

  it('handles Buffers and empty input', () => {
    expect(stripBom(Buffer.from('\uFEFF[]', 'utf8'))).toBe('[]')
    expect(stripBom('')).toBe('')
  })
})

describe('parseJsonSafe', () => {
  it('parses BOM-prefixed JSON (Chrome tolerates the BOM, G22)', () => {
    expect(parseJsonSafe('\uFEFF{"manifest_version":3}')).toEqual({
      manifest_version: 3
    })
  })

  it('parses empty input as {}', () => {
    expect(parseJsonSafe('')).toEqual({})
  })

  it('still throws on invalid JSON', () => {
    expect(() => parseJsonSafe('{nope')).toThrow()
  })
})

// Each row is what the managed Chrome 151 and Firefox 160 did with the same
// text in an unpacked manifest.json, so the reader accepts no more than they do.
describe('parseAuthoredJson', () => {
  const body = '"manifest_version": 3, "name": "x", "version": "1.0.0"'
  const cases: Array<{
    name: string
    text: string
    chrome: boolean
    firefox: boolean
  }> = [
    {name: 'plain JSON', text: `{${body}}`, chrome: true, firefox: true},
    {
      name: 'a // line comment on its own line',
      text: `{\n  // note\n  ${body}\n}`,
      chrome: true,
      firefox: true
    },
    {
      name: 'a // line comment after a value',
      text: `{\n  "a": 1, // note\n  ${body}\n}`,
      chrome: true,
      firefox: true
    },
    {
      name: 'a // line comment on the first and the last line',
      text: `// head\n{${body}}\n// tail\n`,
      chrome: true,
      firefox: true
    },
    {
      name: 'a /* */ block comment',
      text: `{\n  /* note */\n  ${body}\n}`,
      chrome: true,
      firefox: false
    },
    {
      name: 'a /* */ block comment over two lines',
      text: `{\n  /* a\n     note */\n  ${body}\n}`,
      chrome: true,
      firefox: false
    },
    {
      name: 'a trailing comma in an object',
      text: `{${body},}`,
      chrome: false,
      firefox: false
    },
    {
      name: 'a trailing comma in an array',
      text: `{${body}, "permissions": ["tabs",]}`,
      chrome: false,
      firefox: false
    },
    {
      name: 'a UTF-8 byte order mark',
      text: `﻿{${body}}`,
      chrome: true,
      firefox: true
    },
    {
      name: 'a byte order mark and a // line comment',
      text: `﻿{\n  // note\n  ${body}\n}`,
      chrome: true,
      firefox: true
    },
    {
      name: 'a # comment',
      text: `{\n  # note\n  ${body}\n}`,
      chrome: false,
      firefox: false
    },
    {
      name: 'single-quoted strings',
      text: `{'name': 'x'}`,
      chrome: false,
      firefox: false
    }
  ]

  for (const row of cases) {
    for (const browser of ['chrome', 'firefox'] as const) {
      it(`${row[browser] ? 'reads' : 'refuses'} ${row.name} for ${browser}`, () => {
        const read = () => parseAuthoredJson(row.text, {browser})

        if (row[browser]) {
          expect(read()).toMatchObject({name: 'x'})
        } else {
          expect(read).toThrow(SyntaxError)
        }
      })
    }
  }

  it('keeps comment markers that sit inside a string', () => {
    expect(
      parseAuthoredJson('{"homepage_url": "https://example.test/a//b/*c*/"}', {
        browser: 'firefox'
      })
    ).toEqual({homepage_url: 'https://example.test/a//b/*c*/'})
  })

  it('reports a syntax error at its place in the file as written', () => {
    const text =
      '{\n  // a comment first\n  "manifest_version": 3, /* and a block */\n  "name": "x"\n  "version": "1.0.0"\n}\n'

    expect(() => parseAuthoredJson(text, {browser: 'chrome'})).toThrow(
      /position 82 \(line 5 column 3\)/
    )

    expect(text.slice(82, 91)).toBe('"version"')
  })

  it('names the line and column of a block comment Firefox refuses', () => {
    expect(() =>
      parseAuthoredJson('{\n  "a": 1,\n  /* note */\n  "b": 2\n}', {
        browser: 'firefox'
      })
    ).toThrow(/block comment, found at line 3 column 3/)
  })

  it('blanks comments without moving any other character', () => {
    const text = '{\n  "a": 1, // one\n  /* two\n  lines */ "b": 2\n}'
    const scan = blankJsonComments(text)

    expect(scan.text).toHaveLength(text.length)
    expect(scan.text.indexOf('"b"')).toBe(text.indexOf('"b"'))
    expect(scan.text.split('\n')).toHaveLength(text.split('\n').length)
    expect(scan.hasComments).toBe(true)
    expect(hasJsonComments('{"a": "// not one"}')).toBe(false)
  })

  it('reads the manifest Vimium ships, comments and all', () => {
    // Excerpt of manifest.json from Vimium, MIT License,
    // Copyright (c) 2010 Phil Crosby, Ilya Sukhar.
    const vimium = `{
  "manifest_version": 3,
  "name": "Vimium",
  "background": {
    "service_worker": "background_scripts/main.js",
    "type": "module"
    // Uncomment when developing in Firefox.
    // "scripts": ["background_scripts/main.js"]
  },
  "permissions": [
    "tabs",
    // Notifications are used to show a message when Vimium's major version has been upgraded.
    "notifications",
    "favicon", // The favicon permission is not yet supported by Firefox.
    "storage"
  ]
}`

    for (const browser of ['chrome', 'firefox']) {
      expect(parseAuthoredJson(vimium, {browser}).permissions).toEqual([
        'tabs',
        'notifications',
        'favicon',
        'storage'
      ])
    }
  })
})
