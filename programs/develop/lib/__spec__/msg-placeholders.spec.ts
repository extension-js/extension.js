import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  collectMsgReferences,
  findUndefinedMsgReferences
} from '../msg-placeholders'

// The build gate and the pre-launch check read a __MSG_ reference through one
// resolver, duplicated on purpose across the package boundary like
// messaging.ts; this keeps the copy byte-identical to the canonical.
const CANONICAL = path.resolve(__dirname, '..', 'msg-placeholders.ts')
const COPY = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'extension',
  'helpers',
  'msg-placeholders.ts'
)

describe('msg placeholder resolver', () => {
  it('keeps the extension copy byte-identical to the develop canonical', () => {
    const canonical = fs.readFileSync(CANONICAL)
    const copy = fs.readFileSync(COPY)
    expect(createHash('sha256').update(copy).digest('hex')).toBe(
      createHash('sha256').update(canonical).digest('hex')
    )
  })

  it('closes at the first __, keeps @ names, skips @@predefined, dedupes', () => {
    expect(
      collectMsgReferences({
        name: '__MSG_a__b__',
        description: '__MSG_brand@name__ and __MSG_@@ui_locale__',
        nested: ['__MSG_a__', {deep: 'x __MSG_Title__ y'}]
      })
    ).toEqual(['a', 'brand@name', 'Title'])
  })

  it('looks the catalog up case-insensitively and reports names as written', () => {
    expect(
      findUndefinedMsgReferences(
        {name: '__MSG_APPNAME__', description: '__MSG_AppTitle__'},
        ['appName']
      )
    ).toEqual(['AppTitle'])
  })
})
