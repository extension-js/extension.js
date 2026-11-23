import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {describeJsonParseFailure} from '../json-parse-position'

function belowHeader(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^(?:\/\/.*\n)+/, '')
}

describe('json-parse-position', () => {
  it('names the place and none of the text', () => {
    expect(describeJsonParseFailure('root:x:0:0:secret')).toBe(
      'unexpected character at line 1 column 1'
    )
  })

  it('matches programs/develop/lib/json-parse-position.ts below the header', () => {
    const copy = path.resolve(__dirname, '../json-parse-position.ts')
    const canonical = path.resolve(
      __dirname,
      '../../../develop/lib/json-parse-position.ts'
    )

    expect(belowHeader(canonical)).toContain(
      'export function describeJsonParseFailure'
    )

    expect(
      belowHeader(copy),
      'programs/create/lib/json-parse-position.ts drifted from programs/develop/lib/json-parse-position.ts. Copy the develop file over it and keep the create header. The copies are duplicated on purpose, a cross-program import does not compile.'
    ).toBe(belowHeader(canonical))
  })
})
