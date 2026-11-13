import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {useTempFolders} from './helpers/temp-folders'

const made: string[] = []

// Registered first, so it runs after the helper's own removal.
afterAll(() => {
  expect(made).toHaveLength(2)
  expect(made.filter((folder) => fs.existsSync(folder))).toEqual([])
})

const makeTempFolder = useTempFolders()

describe('useTempFolders', () => {
  it('makes a folder in the temp directory under the given prefix', () => {
    const folder = makeTempFolder('extjs-temp-folders-')

    made.push(folder)
    fs.mkdirSync(path.join(folder, 'nested'))
    fs.writeFileSync(
      path.join(folder, 'nested', 'file.txt'),
      'kept until the end'
    )

    expect(path.dirname(folder)).toBe(os.tmpdir())
    expect(path.basename(folder).startsWith('extjs-temp-folders-')).toBe(true)
  })

  it('keeps every folder until the file ends', () => {
    made.push(makeTempFolder('extjs-temp-folders-'))

    expect(made.filter((folder) => fs.existsSync(folder))).toHaveLength(2)
  })
})
