import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {sandbox} from '../sandbox'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function project(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-sandbox-override-'))
  dirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, '<html></html>')
  }
  return path.join(dir, 'manifest.json')
}

describe('sandbox (pages override)', () => {
  it('rewrites in-project pages to the canonical sandbox names', () => {
    const manifestPath = project(['pages/sb.html'])
    const result = sandbox(
      {sandbox: {pages: ['pages/sb.html']}} as any,
      manifestPath
    )
    expect(result?.sandbox.pages).toEqual(['sandbox/page-0.html'])
  })

  it('keeps a public-hosted page at the path the copier ships it to', () => {
    const manifestPath = project(['public/sb.html'])
    const result = sandbox(
      {sandbox: {pages: ['/sb.html']}} as any,
      manifestPath
    )
    expect(result?.sandbox.pages).toEqual(['sb.html'])
  })
})
