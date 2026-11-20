import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const packageDir = path.resolve(__dirname, '..')

// A row for a folder that is gone sends a reader to code that is not there.
describe('the plugin table in the package README', () => {
  it('has one row for each plugin folder and no other', () => {
    const readme = fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8')
    const rows = readme
      .split('\n')
      .map((line) => line.split('|')[1]?.trim() ?? '')
      .filter((name) => name.startsWith('plugin-'))
      .sort()
    const folders = fs
      .readdirSync(packageDir, {withFileTypes: true})
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith('plugin-')
      )
      .map((entry) => entry.name)
      .sort()

    expect(rows).toEqual(folders)
  })
})
