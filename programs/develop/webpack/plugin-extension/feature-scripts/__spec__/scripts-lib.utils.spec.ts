import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {getScriptEntries, getCssEntries} from '../scripts-lib/utils'

describe('scripts-lib/utils', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-utils-'))
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('getScriptEntries returns only existing JS-like files and respects exclude list', () => {
    const dir = tmp
    const files = [
      path.join(dir, 'a.js'),
      path.join(dir, 'b.ts'),
      path.join(dir, 'c.css'),
      path.join(dir, 'dir/d.jsx'),
      path.join(dir, 'skip/me.tsx')
    ]
    fs.mkdirSync(path.join(dir, 'dir'), {recursive: true})
    fs.mkdirSync(path.join(dir, 'skip'), {recursive: true})
    for (const f of files) fs.writeFileSync(f, '')

    const excludeList = {
      'public/skip/me': path.join(dir, 'skip/me.tsx')
    }

    const result = getScriptEntries(files, excludeList)
    expect(result).toEqual([
      path.join(dir, 'a.js'),
      path.join(dir, 'b.ts'),
      path.join(dir, 'dir/d.jsx')
    ])
  })

  it('getCssEntries returns only existing CSS-like files and respects exclude list', () => {
    const dir = tmp
    const files = [
      path.join(dir, 'a.css'),
      path.join(dir, 'b.scss'),
      path.join(dir, 'c.sass'),
      path.join(dir, 'd.less'),
      path.join(dir, 'e.ts')
    ]
    for (const f of files) fs.writeFileSync(f, '')

    const excludeList = {
      'public/b': path.join(dir, 'b.scss')
    }

    const result = getCssEntries(files, excludeList)
    expect(result).toEqual([
      path.join(dir, 'a.css'),
      path.join(dir, 'c.sass'),
      path.join(dir, 'd.less')
    ])
  })
})
