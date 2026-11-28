import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {removeOutputFile} from '../remove-output-file'

const roots: string[] = []

function outputFolder(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-remove-output-'))
  roots.push(root)

  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), 'x')
  }

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('removeOutputFile', () => {
  it('removes the file and every folder it leaves empty', () => {
    const root = outputFolder(['a/b/c.png'])

    removeOutputFile(root, 'a/b/c.png')

    expect(fs.readdirSync(root)).toEqual([])
  })

  it('keeps a folder that still holds another file', () => {
    const root = outputFolder(['a/b/c.png', 'a/keep.png'])

    removeOutputFile(root, 'a/b/c.png')

    expect(fs.existsSync(path.join(root, 'a/b'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'a/keep.png'))).toBe(true)
  })

  it('never removes a file outside the output folder', () => {
    const root = outputFolder(['dist/a.png', 'outside.txt'])

    removeOutputFile(path.join(root, 'dist'), '../outside.txt')

    expect(fs.existsSync(path.join(root, 'outside.txt'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'dist/a.png'))).toBe(true)
  })

  it('does nothing for a name that is not there', () => {
    const root = outputFolder(['a.png'])

    expect(() => removeOutputFile(root, 'missing/b.png')).not.toThrow()
    expect(fs.readdirSync(root)).toEqual(['a.png'])
  })
})
