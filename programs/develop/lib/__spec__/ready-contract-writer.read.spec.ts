import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {readReadyRecord, tryReadReadyRecord} from '../ready-contract-writer'

describe('the one reader of ready.json', () => {
  let tmp: string
  let file: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-read-'))
    file = path.join(tmp, 'ready.json')
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('answers the record a whole file holds, unknown fields included', () => {
    fs.writeFileSync(file, '{"status": "ready", "fieldOfALaterEngine": [1]}\n')

    expect(tryReadReadyRecord(file)).toEqual({
      record: {status: 'ready', fieldOfALaterEngine: [1]}
    })

    expect(readReadyRecord(file)).toEqual({
      status: 'ready',
      fieldOfALaterEngine: [1]
    })
  })

  it('answers nothing, and no error, for a missing file', () => {
    expect(tryReadReadyRecord(file)).toEqual({})
    expect(readReadyRecord(file)).toBeUndefined()
    expect(fs.existsSync(file)).toBe(false)
  })

  it.each([
    ['an empty file', ''],
    ['a half-written file', '{"status": "rea'],
    ['text that is not JSON', 'ready']
  ])('answers the parse error of %s and no record', (_name, text) => {
    fs.writeFileSync(file, text)

    const read = tryReadReadyRecord(file)

    expect(read.record).toBeUndefined()
    expect(read.error).toBeInstanceOf(SyntaxError)
    expect(readReadyRecord(file)).toBeUndefined()
    expect(fs.readFileSync(file, 'utf-8')).toBe(text)
  })

  // dev --wait relays this error, and Node's message quotes the file.
  it('says where a ready.json stops parsing and quotes none of it', () => {
    const secret = 'root:x:0:0:secret-hunter2'
    fs.writeFileSync(file, secret)

    const message = String(tryReadReadyRecord(file).error?.message)

    expect(message).toBe('unexpected character at line 1 column 1')

    for (let i = 0; i + 4 <= secret.length; i++) {
      expect(message).not.toContain(secret.slice(i, i + 4))
    }
  })

  it.each([
    ['null', 'null'],
    ['a number', '7'],
    ['a string', '"ready"'],
    ['true', 'true']
  ])('answers nothing, and no error, for a file that holds %s', (_n, text) => {
    fs.writeFileSync(file, text)

    expect(tryReadReadyRecord(file)).toEqual({})
    expect(readReadyRecord(file)).toBeUndefined()
  })

  it('hands a list through, which every caller reads as no field set', () => {
    fs.writeFileSync(file, '[{"status": "ready"}]')

    expect(readReadyRecord(file)).toEqual([{status: 'ready'}])
    expect(readReadyRecord(file)?.status).toBeUndefined()
  })

  it('answers the error of a path that cannot be read as a file', () => {
    fs.mkdirSync(file)

    const read = tryReadReadyRecord(file)

    expect(read.record).toBeUndefined()
    expect((read.error as NodeJS.ErrnoException).code).toMatch(
      /^E(?:ISDIR|PERM|ACCES)$/
    )

    expect(readReadyRecord(file)).toBeUndefined()
  })
})
