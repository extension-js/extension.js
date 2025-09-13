import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {getSpecialFoldersData} from '../../special-folders'

function writeFileEnsured(filePath: string, content: string = ''): void {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, content)
}

function removeDirIfExists(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, {recursive: true, force: true})
  }
}

describe('getSpecialFoldersData', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-data-special-folders-'))

    // Create a manifest at project root
    writeFileEnsured(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    // Create case-variant Public folder
    writeFileEnsured(path.join(tmpDir, 'Public', 'logo.png'), 'PNG')
    writeFileEnsured(
      path.join(tmpDir, 'Public', 'images', 'icon.svg'),
      '<svg />'
    )

    // Create pages with mix of files; only .html should be included
    writeFileEnsured(
      path.join(tmpDir, 'pages', 'index.html'),
      '<!doctype html>'
    )
    writeFileEnsured(path.join(tmpDir, 'pages', 'readme.md'), '# md')
    writeFileEnsured(
      path.join(tmpDir, 'pages', 'nested', 'about.html'),
      '<!doctype html>'
    )

    // Create scripts with multiple extensions (allowed + disallowed)
    writeFileEnsured(path.join(tmpDir, 'scripts', 'bg.js'), 'console.log("bg")')
    writeFileEnsured(path.join(tmpDir, 'scripts', 'content.ts'), 'export {}')
    writeFileEnsured(path.join(tmpDir, 'scripts', 'data.json'), '{}')
    writeFileEnsured(
      path.join(tmpDir, 'scripts', 'nested', 'app.tsx'),
      'export default 1'
    )
  })

  afterAll(() => {
    removeDirIfExists(tmpDir)
  })

  it('detects case-insensitive public folder and generates absolute include maps', () => {
    const result = getSpecialFoldersData({
      manifestPath: path.join(tmpDir, 'manifest.json')
    })

    // Normalize to lowercase for case-insensitive filesystems
    const lower = (s: string) => s.toLowerCase()
    const lowerCasedPublicEntries = Object.fromEntries(
      Object.entries(result.public).map(([k, v]) => [
        lower(k),
        lower(v as string)
      ])
    )

    expect(lowerCasedPublicEntries).toMatchObject({
      ['public/logo.png']: lower(path.join(tmpDir, 'Public', 'logo.png')),
      ['public/images/icon.svg']: lower(
        path.join(tmpDir, 'Public', 'images', 'icon.svg')
      )
    })

    // pages: preserve nested path and collapse directory index
    expect(result.pages).toMatchObject({
      ['pages/index']: path.join(tmpDir, 'pages', 'index.html'),
      ['pages/nested/about']: path.join(tmpDir, 'pages', 'nested', 'about.html')
    })
    // non-html files should be ignored
    expect(Object.keys(result.pages).some((k) => k.includes('readme'))).toBe(
      false
    )

    // scripts: only allowed extensions, keys are scripts/<filename>
    expect(result.scripts).toMatchObject({
      ['scripts/bg']: path.join(tmpDir, 'scripts', 'bg.js'),
      ['scripts/content']: path.join(tmpDir, 'scripts', 'content.ts'),
      ['scripts/app']: path.join(tmpDir, 'scripts', 'nested', 'app.tsx')
    })
    // disallowed extensions should be ignored
    expect(Object.values(result.scripts)).not.toContain(
      path.join(tmpDir, 'scripts', 'data.json')
    )
  })
})
