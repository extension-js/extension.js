import {describe, expect, it} from 'vitest'
import {
  describeJsonParseFailure,
  describeJsonReadFailure,
  jsonParseFailure
} from '../json-parse-position'

// Each row is a shape Node 20, 22 and 24 word differently: a quoted token with
// no position, a position with and without "(line column)", and an early end.
const ROWS: Array<[name: string, text: string, said: string]> = [
  [
    'a quoted token with no position',
    'root:x:0:0:secret',
    'unexpected character at line 1 column 1'
  ],
  [
    'a missing comma',
    '{"a":1 "b":2}',
    'unexpected character at line 1 column 8'
  ],
  [
    'text after the value',
    '{"a":1}x',
    'unexpected character at line 1 column 8'
  ],
  ['a key with no quotes', '{a:1}', 'unexpected character at line 1 column 2'],
  [
    'a raw newline in a string',
    '"ab\ncd"',
    'unexpected character at line 1 column 4'
  ],
  ['a trailing comma', '[1,\n]', 'unexpected character at line 2 column 1'],
  ['a bad escape', '"\\x"', 'unexpected character at line 1 column 3'],
  ['a leading zero', '01', 'unexpected character at line 1 column 2'],
  ['a byte order mark', '﻿{}', 'unexpected character at line 1 column 1'],
  [
    'a cut short object',
    '{\n  "a":',
    'unexpected end of the file at line 2 column 7'
  ],
  [
    'a cut short word',
    '{"a": tru',
    'unexpected end of the file at line 1 column 10'
  ],
  ['an empty file', '', 'unexpected end of the file at line 1 column 1']
]

describe('where a JSON text stops parsing', () => {
  it.each(ROWS)('names the place for %s', (_name, text, said) => {
    expect(() => JSON.parse(text)).toThrow(SyntaxError)
    expect(describeJsonParseFailure(text)).toBe(said)
  })

  // Node 22 and later add the place to some messages, and it must agree.
  it.each(
    ROWS
  )('agrees with the place Node names, when it names one, for %s', (_name, text) => {
    let message = ''

    try {
      JSON.parse(text)
    } catch (error) {
      message = (error as Error).message
    }

    const node = /\(line (\d+) column (\d+)\)/.exec(message)
    const failure = jsonParseFailure(text)

    if (node) {
      expect([failure?.line, failure?.column]).toEqual([
        Number(node[1]),
        Number(node[2])
      ])
    }
  })

  it.each([
    '{"a":[1,2,{"b":null}],"c":"\\u00e9\\n","d":-1.5e+3,"e":true,"f":false}',
    ' [ ] ',
    '"x"',
    '0',
    '{}'
  ])('finds no fault in %s, which JSON.parse reads', (text) => {
    expect(() => JSON.parse(text)).not.toThrow()
    expect(jsonParseFailure(text)).toBeUndefined()
  })

  it('reads deep nesting without a stack overflow', () => {
    const text = '['.repeat(200000)

    expect(describeJsonParseFailure(text)).toBe(
      'unexpected end of the file at line 1 column 200001'
    )
  })

  it('names a failed read by its errno code and the rest by the text', () => {
    const denied = Object.assign(
      new Error("EACCES: permission denied, open '/x'"),
      {
        code: 'EACCES'
      }
    )

    expect(describeJsonReadFailure(denied)).toBe('EACCES')
    expect(describeJsonReadFailure(new SyntaxError('quoted'), 'oops')).toBe(
      'unexpected character at line 1 column 1'
    )
  })
})
