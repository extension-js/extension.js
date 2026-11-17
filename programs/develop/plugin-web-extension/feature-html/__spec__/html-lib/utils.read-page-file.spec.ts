import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {htmlStaticAssetOutputName, readPageFile} from '../../html-lib/utils'

const created = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-file-'))
const tmp = fs.realpathSync(created)

afterAll(() => {
  fs.rmSync(created, {recursive: true, force: true})
})

describe('reading a file a page names', () => {
  it('reads the file once per compilation, so the name and the bytes of a copy agree', () => {
    const page = path.join(tmp, 'index.html')
    const logo = path.join(tmp, 'logo.png')
    const compilation = {}
    fs.writeFileSync(logo, 'first bytes')

    const name = htmlStaticAssetOutputName(tmp, page, logo, {}, compilation)

    // A save that lands between the emit step and the page rewrite.
    fs.writeFileSync(logo, 'second bytes')

    expect(htmlStaticAssetOutputName(tmp, page, logo, {}, compilation)).toBe(
      name
    )

    expect(readPageFile(compilation, logo).toString()).toBe('first bytes')
  })

  it('reads the file again for the next compilation', () => {
    const page = path.join(tmp, 'index.html')
    const logo = path.join(tmp, 'next.png')
    fs.writeFileSync(logo, 'first bytes')

    const before = htmlStaticAssetOutputName(tmp, page, logo, {}, {})

    fs.writeFileSync(logo, 'second bytes')

    const next = {}

    expect(htmlStaticAssetOutputName(tmp, page, logo, {}, next)).not.toBe(
      before
    )

    expect(readPageFile(next, logo).toString()).toBe('second bytes')
  })
})
