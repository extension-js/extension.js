import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {getScriptEntries} from '../utils'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function tempFile(name: string, contents = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-script-entries-'))
  tempDirs.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, contents, 'utf8')
  return file
}

describe('getScriptEntries', () => {
  it('keeps real script files', () => {
    const js = tempFile('content.js', 'console.log(1)')
    const ts = tempFile('content.ts', 'const a: number = 1')
    expect(getScriptEntries([js, ts])).toEqual([js, ts])
  })

  it('excludes TypeScript declaration files (.d.ts / .d.mts / .d.cts)', () => {
    const js = tempFile('common.js', 'window.x = 1')
    const dts = tempFile('common.d.ts', 'export declare const x: number')
    const dmts = tempFile('common.d.mts', 'export declare const y: number')
    const dcts = tempFile('common.d.cts', 'export declare const z: number')
    expect(getScriptEntries([js, dts, dmts, dcts])).toEqual([js])
  })
})
