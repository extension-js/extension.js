// BUGS_TO_FIX §39 addendum: a root-absolute manifest page ref
// (`options_page: "/page/options.html"`) resolves from the EXTENSION root,
// when the file really lives at the project root the html pipeline compiles
// it, so the dist manifest must point at the compiled surface instead of the
// raw path nothing emits. public/ keeps precedence.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {manifestPageOutputTarget} from '../normalize-manifest-path'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createProject(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-target-'))
  tempDirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, '<html></html>')
  }
  return path.join(dir, 'manifest.json')
}

describe('manifestPageOutputTarget', () => {
  it('maps a relative ref to the compiled surface', () => {
    const manifestPath = createProject(['page/options.html'])
    expect(
      manifestPageOutputTarget(
        'page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('options/index.html')
  })

  it('maps a root-absolute ref that exists at the project root to the compiled surface', () => {
    const manifestPath = createProject(['page/options.html'])
    expect(
      manifestPageOutputTarget(
        '/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('options/index.html')
  })

  it('covers the .htm spelling of the class', () => {
    const manifestPath = createProject(['pages/config.htm'])
    expect(
      manifestPageOutputTarget(
        '/pages/config.htm',
        'options/index.html',
        manifestPath
      )
    ).toBe('options/index.html')
  })

  it('keeps public/ precedence for a root-absolute ref public owns', () => {
    const manifestPath = createProject(['public/page/options.html'])
    expect(
      manifestPageOutputTarget(
        '/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/options.html')
  })

  it('strips the public/ prefix from explicitly public refs', () => {
    const manifestPath = createProject(['public/page/options.html'])
    expect(
      manifestPageOutputTarget(
        '/public/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/options.html')
    expect(
      manifestPageOutputTarget(
        './public/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/options.html')
  })

  it('keeps the normalized raw path when the ref exists nowhere', () => {
    const manifestPath = createProject([])
    expect(
      manifestPageOutputTarget(
        '/page/missing.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/missing.html')
  })
})
